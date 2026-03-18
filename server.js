import express from 'express';
import cors from 'cors';
import path from 'path';
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
  console.warn('Supabase credentials not found or placeholder. Using fallback if available.');
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Rota para upload e compressão da logo
app.post('/api/upload/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Serviço de armazenamento não configurado.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    // Comprimir e converter para WebP
    let compressedBuffer;
    try {
      compressedBuffer = await sharp(req.file.buffer)
        .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 60 })
        .toBuffer();
    } catch (sharpError) {
      console.error('Erro no processamento com Sharp:', sharpError);
      // Fallback: usar o buffer original se o sharp falhar
      compressedBuffer = req.file.buffer;
    }

    const fileName = `logo_${Date.now()}.webp`;
    const filePath = `logos/${fileName}`;

    // Upload para o Supabase Storage
    const { data, error } = await supabase.storage
      .from('edumanager-assets')
      .upload(filePath, compressedBuffer, {
        contentType: 'image/webp',
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Erro no upload para o Supabase:', error);
      // Detailed error for debugging
      const errorMsg = error.message || JSON.stringify(error);
      return res.status(500).json({ 
        error: 'Erro ao salvar a imagem no storage.',
        details: errorMsg,
        bucket: 'edumanager-assets'
      });
    }

    // Obter URL pública
    const { data: publicUrlData } = supabase.storage
      .from('edumanager-assets')
      .getPublicUrl(filePath);

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
    console.error('Tentativa de acesso negada: Token do webhook inválido!');
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
        console.log(`Evento ignorado: ${payload.event}`);
        return res.status(200).json({ message: 'Evento ignorado' });
    }

    const { error } = await supabase
      .from('alunos_cobrancas')
      .update(updateData)
      .eq('asaas_payment_id', asaasPaymentId);

    if (error) {
      console.error(`Erro ao atualizar Supabase para o evento ${payload.event}:`, error);
      throw error;
    }
    
    console.log(`Sucesso: Pagamento ${asaasPaymentId} atualizado via Webhook (${payload.event})!`);
    return res.status(200).json({ message: 'Webhook processado com sucesso' });

  } catch (error) {
    console.error('Erro no Webhook:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// Gerar Cobrança
app.post('/api/gerar_cobranca', async (req, res) => {
  try {
    const { 
      aluno_id, nome, cpf, email, valor, vencimento, multa, juros, desconto,
      telefone, cep, endereco, numero, bairro, descricao, parcelas
    } = req.body;

    // 1. Search or Create Asaas Customer
    let customerId = '';
    
    // Try to find customer by CPF first
    const searchRes = await fetch(`https://sandbox.asaas.com/api/v3/customers?cpfCnpj=${cpf}`, {
      method: 'GET',
      headers: {
        'access_token': process.env.ASAAS_API_KEY
      }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.data && searchData.data.length > 0) {
        customerId = searchData.data[0].id;
      }
    }

    if (!customerId) {
      const customerRes = await fetch('https://sandbox.asaas.com/api/v3/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': process.env.ASAAS_API_KEY
        },
        body: JSON.stringify({
          name: nome,
          cpfCnpj: cpf,
          email: email,
          mobilePhone: telefone,
          postalCode: cep,
          address: endereco,
          addressNumber: numero,
          province: bairro
        })
      });

      if (!customerRes.ok) {
        const errorData = await customerRes.json();
        console.error('Asaas Customer Error:', errorData);
        // Extract specific error message from Asaas if available
        const asaasMsg = errorData.errors?.[0]?.description || 'Falha ao criar cliente no Asaas';
        throw new Error(asaasMsg);
      }

      const customerData = await customerRes.json();
      customerId = customerData.id;
    }

    // 2. Create Asaas Payment
    const asaasPayload = {
      customer: customerId,
      billingType: 'BOLETO',
      dueDate: vencimento,
      description: descricao ? `${descricao} - Microtec Informática Cursos` : 'Mensalidade - Microtec Informática Cursos'
    };

    const isInstallment = parcelas && parseInt(parcelas) > 1;

    if (isInstallment) {
      // Condição B: Parcelamento / Carnê (> 1 Parcela)
      asaasPayload.installmentCount = parseInt(parcelas);
      asaasPayload.installmentValue = parseFloat(valor);
    } else {
      // Condição A: Cobrança Avulsa (1 Parcela)
      asaasPayload.value = parseFloat(valor);
    }

    const fineValue = parseFloat(multa);
    const interestValue = parseFloat(juros);
    const discountValue = parseFloat(desconto);

    if (!isNaN(fineValue) && fineValue > 0) asaasPayload.fine = { value: fineValue, type: 'PERCENTAGE' };
    if (!isNaN(interestValue) && interestValue > 0) asaasPayload.interest = { value: interestValue, type: 'PERCENTAGE' };
    if (!isNaN(discountValue) && discountValue > 0) asaasPayload.discount = { value: discountValue, dueDateLimitDays: 0, type: 'FIXED' };

    console.log('Payload enviado para o Asaas:', asaasPayload);

    const paymentRes = await fetch('https://sandbox.asaas.com/api/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': process.env.ASAAS_API_KEY
      },
      body: JSON.stringify(asaasPayload)
    });

    if (!paymentRes.ok) {
      const errorData = await paymentRes.json();
      console.error('Asaas Payment Error:', errorData);
      const asaasMsg = errorData.errors?.[0]?.description || 'Falha ao criar cobrança no Asaas';
      throw new Error(asaasMsg);
    }

    const paymentData = await paymentRes.json();

    // 3. Save to Supabase
    let paymentsToSave = [];
    
    if (isInstallment && paymentData.installment) {
      // Condição B: Salvar todas as parcelas geradas com o ID do pacote (installment)
      const installmentId = paymentData.installment;
      
      // Buscar todas as cobranças geradas para este parcelamento no Asaas
      const installmentsRes = await fetch(`https://sandbox.asaas.com/api/v3/payments?installment=${installmentId}`, {
        method: 'GET',
        headers: {
          'access_token': process.env.ASAAS_API_KEY
        }
      });
      
      if (installmentsRes.ok) {
        const installmentsData = await installmentsRes.json();
        paymentsToSave = installmentsData.data.map(p => ({
          aluno_id: aluno_id,
          asaas_customer_id: customerId,
          asaas_payment_id: p.id,
          asaas_installment_id: installmentId,
          installment: installmentId, // Mantido para compatibilidade
          valor: p.value,
          vencimento: p.dueDate,
          link_boleto: p.bankSlipUrl
        }));
      } else {
        console.error('Falha ao buscar parcelas do installment:', installmentId);
        throw new Error('Falha ao buscar parcelas do Asaas');
      }
    } else {
       // Condição A: Salvar cobrança avulsa com installment nulo
       paymentsToSave = [{
          aluno_id: aluno_id,
          asaas_customer_id: customerId,
          asaas_payment_id: paymentData.id,
          installment: null, // Obrigatoriamente nulo
          valor: paymentData.value || valor,
          vencimento: paymentData.dueDate || vencimento,
          link_boleto: paymentData.bankSlipUrl
       }];
    }

    console.log('Dados salvos no Supabase:', paymentsToSave);

    const { error: dbError } = await supabase
      .from('alunos_cobrancas')
      .insert(paymentsToSave);

    if (dbError) {
      console.error('Supabase Insert Error:', dbError);
      throw new Error('Falha ao salvar no banco de dados');
    }

    return res.status(200).json({ 
      success: true,
      installment: paymentData.installment || null,
      payments: paymentsToSave,
      bankSlipUrl: paymentsToSave[0]?.link_boleto,
      paymentId: paymentsToSave[0]?.asaas_payment_id
    });

  } catch (error) {
    console.error('Function Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 1. Excluir Cobrança (Inteligência Suprema)
app.post('/api/excluir_cobranca', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID não fornecido' });

    // Acha TODAS as parcelas ligadas a esse ID (seja inst_, pay_ ou UUID)
    const { data: parcelas } = await supabase.from('alunos_cobrancas').select('asaas_payment_id, asaas_installment_id').or(`installment.eq.${id},asaas_installment_id.eq.${id},asaas_payment_id.eq.${id},id.eq.${id}`);

    let instId = id.startsWith('inst_') ? id : null;

    // Limpa tudo no Asaas individualmente para não ser bloqueado
    if (parcelas && parcelas.length > 0) {
      for (let p of parcelas) {
        if (p.asaas_payment_id && p.asaas_payment_id.startsWith('pay_')) {
          await fetch(`https://sandbox.asaas.com/api/v3/payments/${p.asaas_payment_id}`, { method: 'DELETE', headers: { 'access_token': process.env.ASAAS_API_KEY } }).catch(() => {});
        }
        if (!instId && p.asaas_installment_id && p.asaas_installment_id.startsWith('inst_')) {
          instId = p.asaas_installment_id;
        }
      }
    }

    // Tenta excluir o carnê agrupado no Asaas
    if (instId) {
       await fetch(`https://sandbox.asaas.com/api/v3/installments/${instId}`, { method: 'DELETE', headers: { 'access_token': process.env.ASAAS_API_KEY } }).catch(() => {});
    } else if (id.startsWith('inst_')) {
       await fetch(`https://sandbox.asaas.com/api/v3/installments/${id}`, { method: 'DELETE', headers: { 'access_token': process.env.ASAAS_API_KEY } }).catch(() => {});
    } else if (id.startsWith('pay_')) {
       await fetch(`https://sandbox.asaas.com/api/v3/payments/${id}`, { method: 'DELETE', headers: { 'access_token': process.env.ASAAS_API_KEY } }).catch(() => {});
    }

    // Passa o rodo no banco de dados local com segurança
    await supabase.from('alunos_cobrancas').delete().or(`installment.eq.${id},asaas_installment_id.eq.${id},asaas_payment_id.eq.${id},id.eq.${id}`);
    
    return res.status(200).json({ message: 'Tudo excluído com sucesso (Asaas e Local).' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

// 2. Buscar Carnê pelo Parcelamento (Botão da Tabela)
app.get('/api/parcelamentos/:id/carne', async (req, res) => {
  try {
    let id = req.params.id;
    let instId = id.startsWith('inst_') ? id : null;

    // Se não for inst_, acha o ID correto consultando o Asaas
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

    // Se achou o carnê oficial, puxa o PDF!
    if (instId) {
      const asaasRes = await fetch(`https://sandbox.asaas.com/api/v3/installments/${instId}`, { headers: { 'access_token': process.env.ASAAS_API_KEY } });
      if (asaasRes.ok) {
        const data = await asaasRes.json();
        if (data.paymentBookUrl) return res.status(200).json({ status: 'success', type: 'pdf', url: data.paymentBookUrl });
      }
    }
    
    // Fallback
    const { data: parcelas } = await supabase.from('alunos_cobrancas').select('*').or(`installment.eq.${id},asaas_installment_id.eq.${id}`).order('vencimento', { ascending: true });
    const boletos = parcelas ? parcelas.map((c, i) => ({ id: c.id, numero: i + 1, vencimento: c.vencimento, valor: c.valor, linkBoleto: c.link_boleto, status: c.status })) : [];
    return res.status(200).json({ status: 'success', type: 'fallback', boletos, message: 'O PDF agrupado não está disponível. Utilize os boletos abaixo.' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

// 3. Buscar Carnê pelo Aluno (Botão de Imprimir no Topo)
app.get('/api/alunos/:id/carne', async (req, res) => {
  try {
    const { data: cobrancas } = await supabase.from('alunos_cobrancas').select('installment, asaas_installment_id, asaas_payment_id').eq('aluno_id', req.params.id).order('vencimento', { ascending: false });
    if (!cobrancas || cobrancas.length === 0) return res.status(400).json({ error: 'Este aluno não possui cobranças registradas.' });

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
    const boletos = parcelas ? parcelas.map((c, i) => ({ id: c.id, numero: i + 1, vencimento: c.vencimento, valor: c.valor, linkBoleto: c.link_boleto, status: c.status })) : [];
    return res.status(200).json({ status: 'success', type: 'fallback', boletos, message: 'Visualização individual das parcelas ativada.' });
  } catch (error) { return res.status(500).json({ error: 'Erro interno.' }); }
});

// Buscar Link do Boleto ou Recibo
app.get('/api/cobrancas/:id/link', async (req, res) => {
  try {
    const asaasPaymentId = req.params.id;
    const paymentRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${asaasPaymentId}`, {
      method: 'GET',
      headers: {
        'access_token': process.env.ASAAS_API_KEY
      }
    });

    if (!paymentRes.ok) {
      return res.status(404).json({ error: 'Cobrança não encontrada no Asaas.' });
    }

    const paymentData = await paymentRes.json();
    
    return res.status(200).json({ 
      bankSlipUrl: paymentData.bankSlipUrl || paymentData.invoiceUrl,
      transactionReceiptUrl: paymentData.transactionReceiptUrl
    });
  } catch (error) {
    console.error('Erro ao buscar link da cobrança:', error);
    return res.status(500).json({ error: 'Erro interno ao buscar link.' });
  }
});


// Excluir Cobranças em Lote
app.delete('/api/cobrancas/lote', async (req, res) => {
  try {
    const { ids } = req.body; // Array de asaas_payment_ids

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Nenhum ID fornecido para exclusão.' });
    }

    const results = await Promise.all(ids.map(async (id) => {
      try {
        // 1. Deletar no Asaas
        const asaasRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${id}`, {
          method: 'DELETE',
          headers: {
            'access_token': process.env.ASAAS_API_KEY
          }
        });

        if (!asaasRes.ok && asaasRes.status !== 404) {
          const errorData = await asaasRes.json().catch(() => ({}));
          console.error(`Erro ao excluir cobrança ${id} no Asaas:`, errorData);
          return { id, success: false, error: 'Erro no Asaas' };
        }

        // 2. Deletar no Supabase apenas se sucesso no Asaas
        const { error: dbError } = await supabase
          .from('alunos_cobrancas')
          .delete()
          .eq('asaas_payment_id', id);

        return { id, success: true, dbSuccess: !dbError };
      } catch (err) {
        console.error(`Erro ao excluir cobrança ${id}:`, err);
        return { id, success: false, error: err.message };
      }
    }));

    const allSuccess = results.every(r => r.success && r.dbSuccess);
    
    if (allSuccess) {
      return res.status(200).json({ message: 'Todas as cobranças foram excluídas com sucesso.' });
    } else {
      return res.status(207).json({ 
        message: 'Algumas cobranças não puderam ser excluídas totalmente.',
        details: results 
      });
    }

  } catch (error) {
    console.error('Erro na exclusão em lote:', error);
    return res.status(500).json({ error: 'Erro interno ao processar exclusão em lote.' });
  }
});

app.patch('/api/alunos/:id/rematricular', async (req, res) => {
  try {
    const { id } = req.params;
    
    // In this architecture, the frontend syncs the entire state via dbService.
    // This route serves as an acknowledgment for the re-enrollment action.
    
    res.json({ success: true, message: 'Aluno rematriculado com sucesso.' });
  } catch (error) {
    console.error('Erro ao rematricular aluno:', error);
    res.status(500).json({ error: 'Erro interno ao rematricular aluno.' });
  }
});

// Servir arquivos estáticos do frontend em produção
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback do React Router
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
