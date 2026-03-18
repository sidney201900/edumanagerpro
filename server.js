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

// Supabase Setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ekbuvcjsfcczviqqlfit.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrYnV2Y2pzZmNjenZpcXFsZml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTU0MzIsImV4cCI6MjA4NjU3MTQzMn0.oIzBeGF-PjaviZejYb1TeOOEzMm-Jjth1XzvJrjD6us';
let supabase = null;

if (supabaseUrl && supabaseKey && supabaseUrl !== 'your_supabase_project_url') {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (e) {
    console.warn('Failed to initialize Supabase client:', e);
  }
} else {
  console.warn('Supabase credentials not found. Some API routes may fail.');
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } 
});

// Rota para upload e compressão da logo
app.post('/api/upload/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Serviço de armazenamento não configurado.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    let compressedBuffer;
    try {
      compressedBuffer = await sharp(req.file.buffer)
        .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 60 })
        .toBuffer();
    } catch (sharpError) {
      console.error('Erro no processamento com Sharp:', sharpError);
      compressedBuffer = req.file.buffer;
    }

    const fileName = `logo_${Date.now()}.webp`;
    const filePath = `logos/${fileName}`;

    const { data, error } = await supabase.storage
      .from('edumanager-assets')
      .upload(filePath, compressedBuffer, {
        contentType: 'image/webp',
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Erro no upload para o Supabase:', error);
      const errorMsg = error.message || JSON.stringify(error);
      return res.status(500).json({ error: 'Erro ao salvar a imagem no storage.', details: errorMsg });
    }

    const { data: publicUrlData } = supabase.storage.from('edumanager-assets').getPublicUrl(filePath);
    return res.status(200).json({ url: publicUrlData.publicUrl });
  } catch (error) {
    console.error('Erro ao processar logo:', error);
    return res.status(500).json({ error: 'Erro interno ao processar a imagem.' });
  }
});

// Webhook Asaas
app.post('/api/webhook_asaas', async (req, res) => {
  const tokenRecebido = req.headers['asaas-access-token'];
  if (tokenRecebido !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const payload = req.body;
    const asaasPaymentId = payload.payment.id;
    let updateData = {};

    switch (payload.event) {
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED':
        updateData = { 
          status: 'PAGO', 
          valor: payload.payment.value,
          data_pagamento: payload.payment.confirmedDate || payload.payment.paymentDate || new Date().toISOString().split('T')[0]
        };
        break;
      case 'PAYMENT_OVERDUE':
        updateData = { status: 'ATRASADO', valor: payload.payment.value };
        break;
      case 'PAYMENT_DELETED':
        updateData = { status: 'CANCELADO' };
        break;
      case 'PAYMENT_UPDATED':
        updateData = { valor: payload.payment.value, vencimento: payload.payment.dueDate };
        break;
      default:
        return res.status(200).json({ message: 'Evento ignorado' });
    }

    const { error } = await supabase.from('alunos_cobrancas').update(updateData).eq('asaas_payment_id', asaasPaymentId);
    if (error) throw error;
    
    return res.status(200).json({ message: 'Webhook processado com sucesso' });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// Gerar Cobrança
app.post('/api/gerar_cobranca', async (req, res) => {
  try {
    const { aluno_id, nome, cpf, email, valor, vencimento, multa, juros, desconto, telefone, cep, endereco, numero, bairro, descricao, parcelas } = req.body;

    let customerId = '';
    const searchRes = await fetch(`https://sandbox.asaas.com/api/v3/customers?cpfCnpj=${cpf}`, {
      method: 'GET',
      headers: { 'access_token': process.env.ASAAS_API_KEY }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.data && searchData.data.length > 0) customerId = searchData.data[0].id;
    }

    if (!customerId) {
      const customerRes = await fetch('https://sandbox.asaas.com/api/v3/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
        body: JSON.stringify({ name: nome, cpfCnpj: cpf, email, mobilePhone: telefone, postalCode: cep, address: endereco, addressNumber: numero, province: bairro })
      });

      if (!customerRes.ok) {
        const errorData = await customerRes.json();
        throw new Error(errorData.errors?.[0]?.description || 'Falha ao criar cliente no Asaas');
      }

      const customerData = await customerRes.json();
      customerId = customerData.id;
    }

    const asaasPayload = {
      customer: customerId,
      billingType: 'BOLETO',
      dueDate: vencimento,
      description: descricao ? `${descricao} - Microtec Informática Cursos` : 'Mensalidade - Microtec Informática Cursos'
    };

    const isInstallment = parcelas && parseInt(parcelas) > 1;

    if (isInstallment) {
      asaasPayload.installmentCount = parseInt(parcelas);
      asaasPayload.installmentValue = parseFloat(valor);
    } else {
      asaasPayload.value = parseFloat(valor);
    }

    const fineValue = parseFloat(multa);
    const interestValue = parseFloat(juros);
    const discountValue = parseFloat(desconto);

    if (!isNaN(fineValue) && fineValue > 0) asaasPayload.fine = { value: fineValue, type: 'PERCENTAGE' };
    if (!isNaN(interestValue) && interestValue > 0) asaasPayload.interest = { value: interestValue, type: 'PERCENTAGE' };
    if (!isNaN(discountValue) && discountValue > 0) asaasPayload.discount = { value: discountValue, dueDateLimitDays: 0, type: 'FIXED' };

    const paymentRes = await fetch('https://sandbox.asaas.com/api/v3/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
      body: JSON.stringify(asaasPayload)
    });

    if (!paymentRes.ok) {
      const errorData = await paymentRes.json();
      throw new Error(errorData.errors?.[0]?.description || 'Falha ao criar cobrança no Asaas');
    }

    const paymentData = await paymentRes.json();
    let paymentsToSave = [];
    
    if (isInstallment && paymentData.installment) {
      const installmentId = paymentData.installment;
      const installmentsRes = await fetch(`https://sandbox.asaas.com/api/v3/payments?installment=${installmentId}`, {
        method: 'GET',
        headers: { 'access_token': process.env.ASAAS_API_KEY }
      });
      
      if (installmentsRes.ok) {
        const installmentsData = await installmentsRes.json();
        paymentsToSave = installmentsData.data.map(p => ({
          aluno_id: aluno_id,
          asaas_customer_id: customerId,
          asaas_payment_id: p.id,
          asaas_installment_id: installmentId,
          installment: installmentId,
          valor: p.value,
          vencimento: p.dueDate,
          link_boleto: p.bankSlipUrl
        }));
      } else {
        throw new Error('Falha ao buscar parcelas do Asaas');
      }
    } else {
       paymentsToSave = [{
         aluno_id: aluno_id,
         asaas_customer_id: customerId,
         asaas_payment_id: paymentData.id,
         installment: null,
         valor: paymentData.value || valor,
         vencimento: paymentData.dueDate || vencimento,
         link_boleto: paymentData.bankSlipUrl
       }];
    }

    const { error: dbError } = await supabase.from('alunos_cobrancas').insert(paymentsToSave);
    if (dbError) throw new Error('Falha ao salvar no banco de dados');

    return res.status(200).json({ 
      success: true,
      installment: paymentData.installment || null,
      payments: paymentsToSave,
      bankSlipUrl: paymentsToSave[0]?.link_boleto,
      paymentId: paymentsToSave[0]?.asaas_payment_id
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Excluir Cobrança (Metralhadora: Apaga no Asaas e localmente)
app.post('/api/excluir_cobranca', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID não fornecido' });

    const { data: parcelas } = await supabase
      .from('alunos_cobrancas')
      .select('*')
      .or(`installment.eq.${id},asaas_installment_id.eq.${id},asaas_payment_id.eq.${id},id.eq.${id}`);

    let instId = null;

    if (parcelas && parcelas.length > 0) {
      for (let p of parcelas) {
        if (p.asaas_payment_id && p.asaas_payment_id.startsWith('pay_')) {
          await fetch(`https://sandbox.asaas.com/api/v3/payments/${p.asaas_payment_id}`, {
            method: 'DELETE',
            headers: { 'access_token': process.env.ASAAS_API_KEY }
          }).catch(() => {});
        }
        if (!instId && (p.asaas_installment_id || p.installment)) {
          instId = p.asaas_installment_id || p.installment;
        }
      }
    }

    let asaasInstId = instId && instId.startsWith('inst_') ? instId : (id.startsWith('inst_') ? id : null);
    if (asaasInstId) {
      await fetch(`https://sandbox.asaas.com/api/v3/installments/${asaasInstId}`, {
        method: 'DELETE',
        headers: { 'access_token': process.env.ASAAS_API_KEY }
      }).catch(() => {});
    } else if (id.startsWith('pay_')) {
      await fetch(`https://sandbox.asaas.com/api/v3/payments/${id}`, {
        method: 'DELETE',
        headers: { 'access_token': process.env.ASAAS_API_KEY }
      }).catch(() => {});
    }

    // Exclusão garantida no banco local independentemente da resposta do Asaas
    await supabase.from('alunos_cobrancas').delete().eq('installment', id);
    await supabase.from('alunos_cobrancas').delete().eq('asaas_installment_id', id);
    await supabase.from('alunos_cobrancas').delete().eq('asaas_payment_id', id);
    await supabase.from('alunos_cobrancas').delete().eq('id', id);

    return res.status(200).json({ message: 'Excluído com sucesso!' });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao processar exclusão.' });
  }
});

// Buscar Carnê pelo Parcelamento
app.get('/api/parcelamentos/:id/carne', async (req, res) => {
  try {
    let id = req.params.id;
    let instId = id.startsWith('inst_') ? id : null;

    if (!instId) {
      const { data: dbData } = await supabase.from('alunos_cobrancas').select('asaas_installment_id, asaas_payment_id').or(`installment.eq.${id},id.eq.${id}`).limit(1);
      if (dbData && dbData.length > 0) {
        if (dbData[0].asaas_installment_id && dbData[0].asaas_installment_id.startsWith('inst_')) {
          instId = dbData[0].asaas_installment_id;
        } else if (dbData[0].asaas_payment_id && dbData[0].asaas_payment_id.startsWith('pay_')) {
          const payRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${dbData[0].asaas_payment_id}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
          if (payRes.ok) {
            const payData = await payRes.json();
            if (payData.installment) instId = payData.installment;
          }
        }
      }
    }

    if (instId) {
      const asaasRes = await fetch(`https://sandbox.asaas.com/api/v3/installments/${instId}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
      if (asaasRes.ok) {
        const data = await asaasRes.json();
        if (data.paymentBookUrl) return res.status(200).json({ status: 'success', type: 'pdf', url: data.paymentBookUrl });
      }
    }
    
    const { data: parcelas } = await supabase.from('alunos_cobrancas').select('*').or(`installment.eq.${id},asaas_installment_id.eq.${id}`).order('vencimento', { ascending: true });
    // Modificado para retornar asaasPaymentId e alimentar o botão de código de barras
    const boletos = parcelas ? parcelas.map((c, i) => ({ id: c.id, numero: i + 1, vencimento: c.vencimento, valor: c.valor, linkBoleto: c.link_boleto, status: c.status, asaasPaymentId: c.asaas_payment_id })) : [];
    return res.status(200).json({ status: 'success', type: 'fallback', boletos, message: 'PDF agrupado não disponível. Use os boletos individuais abaixo.' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

// Buscar Carnê pelo Aluno
app.get('/api/alunos/:id/carne', async (req, res) => {
  try {
    const { data: cobrancas } = await supabase.from('alunos_cobrancas').select('installment, asaas_installment_id, asaas_payment_id').eq('aluno_id', req.params.id).order('vencimento', { ascending: false });
    if (!cobrancas || cobrancas.length === 0) return res.status(400).json({ error: 'Aluno sem cobranças registradas.' });

    let instId = null;
    for (let c of cobrancas) {
      if ((c.asaas_installment_id && c.asaas_installment_id.startsWith('inst_')) || (c.installment && c.installment.startsWith('inst_'))) {
        instId = c.asaas_installment_id || c.installment; break;
      }
    }

    if (!instId) {
      for (let c of cobrancas) {
        if (c.asaas_payment_id && c.asaas_payment_id.startsWith('pay_')) {
          const payRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${c.asaas_payment_id}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
          if (payRes.ok) {
            const payData = await payRes.json();
            if (payData.installment) { instId = payData.installment; break; }
          }
        }
      }
    }

    if (instId) {
      const asaasRes = await fetch(`https://sandbox.asaas.com/api/v3/installments/${instId}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
      if (asaasRes.ok) {
        const data = await asaasRes.json();
        if (data.paymentBookUrl) return res.status(200).json({ status: 'success', type: 'pdf', url: data.paymentBookUrl });
      }
    }

    const fallbackId = instId || cobrancas.find(c => c.installment)?.installment;
    if (!fallbackId) return res.status(400).json({ error: 'Nenhum carnê agrupado encontrado.' });
    
    const { data: parcelas } = await supabase.from('alunos_cobrancas').select('*').or(`installment.eq.${fallbackId},asaas_installment_id.eq.${fallbackId}`).order('vencimento', { ascending: true });
    // Modificado para retornar asaasPaymentId
    const boletos = parcelas ? parcelas.map((c, i) => ({ id: c.id, numero: i + 1, vencimento: c.vencimento, valor: c.valor, linkBoleto: c.link_boleto, status: c.status, asaasPaymentId: c.asaas_payment_id })) : [];
    return res.status(200).json({ status: 'success', type: 'fallback', boletos, message: 'Visualização individual ativada.' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

// Buscar Link do Boleto ou Recibo
app.get('/api/cobrancas/:id/link', async (req, res) => {
  try {
    const asaasPaymentId = req.params.id;
    const paymentRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${asaasPaymentId}`, {
      method: 'GET',
      headers: { 'access_token': process.env.ASAAS_API_KEY }
    });

    if (!paymentRes.ok) return res.status(404).json({ error: 'Cobrança não encontrada no Asaas.' });

    const paymentData = await paymentRes.json();
    return res.status(200).json({ 
      bankSlipUrl: paymentData.bankSlipUrl || paymentData.invoiceUrl,
      transactionReceiptUrl: paymentData.transactionReceiptUrl
    });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

// Excluir Cobranças em Lote
app.delete('/api/cobrancas/lote', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Nenhum ID fornecido.' });

    const results = await Promise.all(ids.map(async (id) => {
      try {
        const asaasRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${id}`, {
          method: 'DELETE',
          headers: { 'access_token': process.env.ASAAS_API_KEY }
        });
        if (!asaasRes.ok && asaasRes.status !== 404) return { id, success: false };
        const { error: dbError } = await supabase.from('alunos_cobrancas').delete().eq('asaas_payment_id', id);
        return { id, success: true, dbSuccess: !dbError };
      } catch (err) { return { id, success: false }; }
    }));

    return res.status(200).json({ message: 'Processado.', details: results });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

app.patch('/api/alunos/:id/rematricular', async (req, res) => {
  res.json({ success: true, message: 'Aluno rematriculado com sucesso.' });
});

// --- LÓGICA SIMPLIFICADA PARA DEV E PROD ---
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('API do EduManager operante!'));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
