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
      return res.status(500).json({ error: 'Erro ao salvar a imagem no storage.', details: error.message });
    }

    const { data: publicUrlData } = supabase.storage.from('edumanager-assets').getPublicUrl(filePath);
    return res.status(200).json({ url: publicUrlData.publicUrl });
  } catch (error) {
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

      if (!customerRes.ok) throw new Error('Falha ao criar cliente no Asaas');
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

    if (multa > 0) asaasPayload.fine = { value: parseFloat(multa), type: 'PERCENTAGE' };
    if (juros > 0) asaasPayload.interest = { value: parseFloat(juros), type: 'PERCENTAGE' };
    if (desconto > 0) asaasPayload.discount = { value: parseFloat(desconto), dueDateLimitDays: 0, type: 'FIXED' };

    const paymentRes = await fetch('https://sandbox.asaas.com/api/v3/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'access_token': process.env.ASAAS_API_KEY },
      body: JSON.stringify(asaasPayload)
    });

    if (!paymentRes.ok) throw new Error('Falha ao criar cobrança no Asaas');
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
