import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cors());

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ekbuvcjsfcczviqqlfit.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrYnV2Y2pzZmNjenZpcXFsZml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTU0MzIsImV4cCI6MjA4NjU3MTQzMn0.oIzBeGF-PjaviZejYb1TeOOEzMm-Jjth1XzvJrjD6us';
let supabase = null;

if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
  try { supabase = createClient(supabaseUrl, supabaseKey); } catch (e) { console.warn('Failed to initialize Supabase client:', e); }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/upload/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Serviço não configurado.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo.' });
    let compressedBuffer;
    try { compressedBuffer = await sharp(req.file.buffer).resize(500, 500, { fit: 'inside' }).webp({ quality: 60 }).toBuffer(); } 
    catch (e) { compressedBuffer = req.file.buffer; }

    const filePath = `logos/logo_${Date.now()}.webp`;
    const { error } = await supabase.storage.from('edumanager-assets').upload(filePath, compressedBuffer, { contentType: 'image/webp', upsert: true });
    if (error) return res.status(500).json({ error: 'Erro upload.' });
    const { data } = supabase.storage.from('edumanager-assets').getPublicUrl(filePath);
    return res.status(200).json({ url: data.publicUrl });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

app.post('/api/webhook_asaas', async (req, res) => {
  if (req.headers['asaas-access-token'] !== process.env.ASAAS_WEBHOOK_TOKEN) return res.status(401).json({ error: 'Não autorizado' });
  try {
    const { payment, event } = req.body;
    let updateData = {};
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      updateData = { status: 'PAGO', valor: payment.value, data_pagamento: payment.confirmedDate || payment.paymentDate || new Date().toISOString().split('T')[0] };
    } else if (event === 'PAYMENT_OVERDUE') updateData = { status: 'ATRASADO', valor: payment.value };
    else if (event === 'PAYMENT_DELETED') updateData = { status: 'CANCELADO' };
    else if (event === 'PAYMENT_UPDATED') updateData = { valor: payment.value, vencimento: payment.dueDate };
    else return res.status(200).json({ message: 'Ignorado' });

    await supabase.from('alunos_cobrancas').update(updateData).eq('asaas_payment_id', payment.id);
    return res.status(200).json({ message: 'OK' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno' }); }
});

app.post('/api/gerar_cobranca', async (req, res) => {
  try {
    const { aluno_id, nome, cpf, email, valor, vencimento, multa, juros, desconto, telefone, cep, endereco, numero, bairro, descricao, parcelas } = req.body;
    let customerId = '';
    const searchRes = await fetch(`https://sandbox.asaas.com/api/v3/customers?cpfCnpj=${cpf}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
    if (searchRes.ok) { const sd = await searchRes.json(); if (sd.data?.length > 0) customerId = sd.data[0].id; }

    if (!customerId) {
      const cr = await fetch('https://sandbox.asaas.com/api/v3/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
        body: JSON.stringify({ name: nome, cpfCnpj: cpf, email, mobilePhone: telefone, postalCode: cep, address: endereco, addressNumber: numero, province: bairro })
      });
      if (!cr.ok) throw new Error('Falha ao criar cliente Asaas');
      customerId = (await cr.json()).id;
    }

    const asaasPayload = { customer: customerId, billingType: 'BOLETO', dueDate: vencimento, description: descricao || 'Mensalidade' };
    const isInst = parcelas && parseInt(parcelas) > 1;
    if (isInst) { asaasPayload.installmentCount = parseInt(parcelas); asaasPayload.installmentValue = parseFloat(valor); } 
    else { asaasPayload.value = parseFloat(valor); }
    if (multa > 0) asaasPayload.fine = { value: parseFloat(multa), type: 'PERCENTAGE' };
    if (juros > 0) asaasPayload.interest = { value: parseFloat(juros), type: 'PERCENTAGE' };
    if (desconto > 0) asaasPayload.discount = { value: parseFloat(desconto), dueDateLimitDays: 0, type: 'FIXED' };

    const pr = await fetch('https://sandbox.asaas.com/api/v3/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
      body: JSON.stringify(asaasPayload)
    });
    if (!pr.ok) throw new Error('Falha ao criar cobrança no Asaas');
    
    const paymentData = await pr.json();
    let paymentsToSave = [];
    
    if (isInst && paymentData.installment) {
      const instId = paymentData.installment;
      const ir = await fetch(`https://sandbox.asaas.com/api/v3/payments?installment=${instId}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
      if (!ir.ok) throw new Error('Falha ao buscar parcelas');
      const instData = await ir.json();
      paymentsToSave = instData.data.map(p => ({
        aluno_id, asaas_customer_id: customerId, asaas_payment_id: p.id, asaas_installment_id: instId,
        installment: instId, valor: p.value, vencimento: p.dueDate, link_boleto: p.bankSlipUrl
      }));
    } else {
       paymentsToSave = [{ aluno_id, asaas_customer_id: customerId, asaas_payment_id: paymentData.id, installment: null, valor: paymentData.value || valor, vencimento: paymentData.dueDate || vencimento, link_boleto: paymentData.bankSlipUrl }];
    }

    await supabase.from('alunos_cobrancas').insert(paymentsToSave);
    return res.status(200).json({ success: true, installment: paymentData.installment || null, payments: paymentsToSave, bankSlipUrl: paymentsToSave[0]?.link_boleto, paymentId: paymentsToSave[0]?.asaas_payment_id });
  } catch (error) { return res.status(500).json({ error: error.message }); }
});

app.post('/api/excluir_cobranca', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID não fornecido' });

    const { data: parcelas } = await supabase.from('alunos_cobrancas').select('*').or(`installment.eq.${id},asaas_installment_id.eq.${id},asaas_payment_id.eq.${id},id.eq.${id}`);
    let instId = null;

    if (parcelas && parcelas.length > 0) {
      for (let p of parcelas) {
        if (p.asaas_payment_id && p.asaas_payment_id.startsWith('pay_')) {
          await fetch(`https://sandbox.asaas.com/api/v3/payments/${p.asaas_payment_id}`, { method: 'DELETE', headers: { 'access_token': process.env.ASAAS_API_KEY } }).catch(()=>{});
        }
        if (!instId && (p.asaas_installment_id || p.installment)) instId = p.asaas_installment_id || p.installment;
      }
    }

    let asaasInstId = instId && instId.startsWith('inst_') ? instId : (id.startsWith('inst_') ? id : null);
    if (asaasInstId) {
      await fetch(`https://sandbox.asaas.com/api/v3/installments/${asaasInstId}`, { method: 'DELETE', headers: { 'access_token': process.env.ASAAS_API_KEY } }).catch(()=>{});
    } else if (id.startsWith('pay_')) {
      await fetch(`https://sandbox.asaas.com/api/v3/payments/${id}`, { method: 'DELETE', headers: { 'access_token': process.env.ASAAS_API_KEY } }).catch(()=>{});
    }

    await supabase.from('alunos_cobrancas').delete().eq('installment', id);
    await supabase.from('alunos_cobrancas').delete().eq('asaas_installment_id', id);
    await supabase.from('alunos_cobrancas').delete().eq('asaas_payment_id', id);
    await supabase.from('alunos_cobrancas').delete().eq('id', id);

    return res.status(200).json({ message: 'Excluído com sucesso!' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno na exclusão.' }); }
});

app.get('/api/parcelamentos/:id/carne', async (req, res) => {
  try {
    let id = req.params.id;
    let instId = id.startsWith('inst_') ? id : null;

    if (!instId) {
      const { data: dbData } = await supabase.from('alunos_cobrancas').select('asaas_installment_id, asaas_payment_id').or(`installment.eq.${id},id.eq.${id}`).limit(1);
      if (dbData && dbData.length > 0) {
        if (dbData[0].asaas_installment_id?.startsWith('inst_')) instId = dbData[0].asaas_installment_id;
        else if (dbData[0].asaas_payment_id?.startsWith('pay_')) {
          const payRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${dbData[0].asaas_payment_id}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
          if (payRes.ok) { const payData = await payRes.json(); if (payData.installment) instId = payData.installment; }
        }
      }
    }

    if (instId) {
      const ar = await fetch(`https://sandbox.asaas.com/api/v3/installments/${instId}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
      if (ar.ok) { const data = await ar.json(); if (data.paymentBookUrl) return res.status(200).json({ status: 'success', type: 'pdf', url: data.paymentBookUrl }); }
    }
    
    const { data: parcelas } = await supabase.from('alunos_cobrancas').select('*').or(`installment.eq.${id},asaas_installment_id.eq.${id}`).order('vencimento', { ascending: true });
    const boletos = parcelas ? parcelas.map((c, i) => ({ id: c.id, numero: i + 1, vencimento: c.vencimento, valor: c.valor, linkBoleto: c.link_boleto, status: c.status, asaasPaymentId: c.asaas_payment_id })) : [];
    return res.status(200).json({ status: 'success', type: 'fallback', boletos, message: 'PDF não disponível. Use os boletos.' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

app.get('/api/alunos/:id/carne', async (req, res) => {
  try {
    const { data: cobrancas } = await supabase.from('alunos_cobrancas').select('*').eq('aluno_id', req.params.id).order('vencimento', { ascending: false });
    if (!cobrancas || cobrancas.length === 0) return res.status(400).json({ error: 'Aluno sem cobranças.' });

    let instId = null;
    for (let c of cobrancas) { if (c.asaas_installment_id?.startsWith('inst_') || c.installment?.startsWith('inst_')) { instId = c.asaas_installment_id || c.installment; break; } }

    if (!instId) {
      for (let c of cobrancas) {
        if (c.asaas_payment_id?.startsWith('pay_')) {
          const payRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${c.asaas_payment_id}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
          if (payRes.ok) { const payData = await payRes.json(); if (payData.installment) { instId = payData.installment; break; } }
        }
      }
    }

    if (instId) {
      const ar = await fetch(`https://sandbox.asaas.com/api/v3/installments/${instId}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
      if (ar.ok) { const data = await ar.json(); if (data.paymentBookUrl) return res.status(200).json({ status: 'success', type: 'pdf', url: data.paymentBookUrl }); }
    }

    const fallbackId = instId || cobrancas.find(c => c.installment)?.installment;
    if (!fallbackId) return res.status(400).json({ error: 'Nenhum carnê agrupado.' });
    
    const { data: parcelas } = await supabase.from('alunos_cobrancas').select('*').or(`installment.eq.${fallbackId},asaas_installment_id.eq.${fallbackId}`).order('vencimento', { ascending: true });
    const boletos = parcelas ? parcelas.map((c, i) => ({ id: c.id, numero: i + 1, vencimento: c.vencimento, valor: c.valor, linkBoleto: c.link_boleto, status: c.status, asaasPaymentId: c.asaas_payment_id })) : [];
    return res.status(200).json({ status: 'success', type: 'fallback', boletos, message: 'Visualização individual.' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

app.get('/api/cobrancas/:id/link', async (req, res) => {
  try {
    const p = await fetch(`https://sandbox.asaas.com/api/v3/payments/${req.params.id}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
    if (!p.ok) return res.status(404).json({ error: 'Não encontrada.' });
    const d = await p.json();
    return res.status(200).json({ bankSlipUrl: d.bankSlipUrl || d.invoiceUrl, transactionReceiptUrl: d.transactionReceiptUrl });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

app.patch('/api/alunos/:id/rematricular', async (req, res) => res.json({ success: true }));

// --- LÓGICA DE INICIALIZAÇÃO CORRIGIDA PARA EXPRESS 5 ---
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // Substituímos o app.get('*') pelo app.use() para evitar o erro do path-to-regexp v8
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('API Operante!'));
}

app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 Servidor rodando na porta ${PORT}`); });
