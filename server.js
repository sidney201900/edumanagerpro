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
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Supabase Setup
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_KEY;
  let supabase = null;
  
  if (supabaseUrl && supabaseKey) {
    try {
      supabase = createClient(supabaseUrl, supabaseKey);
    } catch (e) {
      console.warn('Failed to initialize Supabase client:', e);
    }
  } else {
    console.warn('Supabase credentials not found. Some API routes may fail.');
  }

const upload = multer({ storage: multer.memoryStorage() });

// Rota para upload e compressão da logo
app.post('/api/upload/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    // Comprimir e converter para WebP
    const compressedBuffer = await sharp(req.file.buffer)
      .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 60 })
      .toBuffer();

    const fileName = `logo_${Date.now()}.webp`;
    const filePath = `logos/${fileName}`;

    // Upload para o Supabase Storage
    const { data, error } = await supabase.storage
      .from('edumanager-assets')
      .upload(filePath, compressedBuffer, {
        contentType: 'image/webp',
        upsert: true
      });

    if (error) {
      console.error('Erro no upload para o Supabase:', error);
      return res.status(500).json({ error: 'Erro ao salvar a imagem no storage.' });
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
    console.log('Resposta do Asaas (Criação):', paymentData);

    // 3. Save to Supabase
    let paymentsToSave = [];
    
    // Identificar o ID do Carnê (inst_...). 
    // Se for um parcelamento, o ID principal é inst_...
    // Se for uma cobrança avulsa que por acaso gerou installment, pegamos do campo installment.
    const installmentId = paymentData.id?.startsWith('inst_') ? paymentData.id : paymentData.installment;

    if (isInstallment && installmentId) {
      // Condição B: Salvar todas as parcelas geradas com o ID do pacote (installment)
      console.log('Detectado Parcelamento. ID do Carnê:', installmentId);
      
      // Buscar todas as cobranças geradas para este parcelamento no Asaas
      const installmentsRes = await fetch(`https://sandbox.asaas.com/api/v3/payments?installment=${installmentId}`, {
        method: 'GET',
        headers: {
          'access_token': process.env.ASAAS_API_KEY
        }
      });
      
      if (installmentsRes.ok) {
        const installmentsData = await installmentsRes.json();
        console.log(`Encontradas ${installmentsData.data.length} parcelas no Asaas.`);

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
       console.log('Detectada Cobrança Avulsa. ID:', paymentData.id);
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

    console.log('Enviando para o Supabase:', paymentsToSave);

    const { error: dbError } = await supabase
      .from('alunos_cobrancas')
      .insert(paymentsToSave);

    if (dbError) {
      console.error('Supabase Insert Error:', dbError);
      throw new Error('Falha ao salvar no banco de dados');
    }

    return res.status(200).json({ 
      success: true,
      installment: installmentId || null,
      payments: paymentsToSave,
      bankSlipUrl: paymentsToSave[0]?.link_boleto,
      paymentId: paymentsToSave[0]?.asaas_payment_id
    });

  } catch (error) {
    console.error('Function Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Excluir Cobrança
app.post('/api/excluir_cobranca', async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'ID não fornecido' });
    }

    if (id.startsWith('inst_')) {
      // 1. Deletar Parcelamento no Asaas
      const asaasResponse = await fetch(`https://sandbox.asaas.com/api/v3/installments/${id}`, {
        method: 'DELETE',
        headers: {
          'access_token': process.env.ASAAS_API_KEY
        }
      });

      if (!asaasResponse.ok && asaasResponse.status !== 404) {
        const errorData = await asaasResponse.json().catch(() => ({}));
        const asaasErrorMessage = errorData.errors?.[0]?.description || 'Erro ao excluir parcelamento no Asaas';
        console.error('Erro ao deletar parcelamento no Asaas:', asaasErrorMessage);
        return res.status(400).json({ error: asaasErrorMessage });
      }

      // 2. Deletar no Supabase apenas se sucesso no Asaas
      const { error: deleteError } = await supabase
        .from('alunos_cobrancas')
        .delete()
        .or(`installment.eq.${id},asaas_installment_id.eq.${id}`);

      if (deleteError) {
        console.error('Erro ao deletar parcelamento no Supabase:', deleteError);
        return res.status(500).json({ error: 'Erro ao deletar no banco de dados' });
      }

      return res.status(200).json({ message: 'Parcelamento excluído com sucesso' });

    } else if (id.startsWith('pay_')) {
      // 1. Deletar Cobrança Avulsa/Parcela no Asaas
      const asaasResponse = await fetch(`https://sandbox.asaas.com/api/v3/payments/${id}`, {
        method: 'DELETE',
        headers: {
          'access_token': process.env.ASAAS_API_KEY
        }
      });

      if (!asaasResponse.ok && asaasResponse.status !== 404) {
        const errorData = await asaasResponse.json().catch(() => ({}));
        const asaasErrorMessage = errorData.errors?.[0]?.description || 'Erro ao excluir cobrança no Asaas';
        console.error('Erro ao deletar cobrança no Asaas:', asaasErrorMessage);
        return res.status(400).json({ error: asaasErrorMessage });
      }

      // 2. Deletar no Supabase apenas se sucesso no Asaas
      const { error: deleteError } = await supabase
        .from('alunos_cobrancas')
        .delete()
        .eq('asaas_payment_id', id);

      if (deleteError) {
        console.error('Erro ao deletar cobrança no Supabase:', deleteError);
        return res.status(500).json({ error: 'Erro ao deletar no banco de dados' });
      }

      return res.status(200).json({ message: 'Cobrança excluída com sucesso' });
    } else {
      return res.status(400).json({ error: 'Formato de ID inválido' });
    }

  } catch (error) {
    console.error('Erro na função excluir_cobranca:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// Buscar Carnê (Payment Book) do Aluno
app.get('/api/parcelamentos/:id/carne', async (req, res) => {
  try {
    const installmentId = req.params.id;

    console.log(`Buscando carnê para o installment: ${installmentId}`);

    // 1. Buscar detalhes do parcelamento no Asaas
    const installmentRes = await fetch(`https://sandbox.asaas.com/api/v3/installments/${installmentId}`, {
      method: 'GET',
      headers: {
        'access_token': process.env.ASAAS_API_KEY
      }
    });

    if (!installmentRes.ok) {
      const errorData = await installmentRes.json();
      console.error(`Erro ao buscar installment ${installmentId} no Asaas:`, errorData);
      return res.status(500).json({ error: 'Erro ao buscar dados do carnê no Asaas.' });
    }

    const installmentData = await installmentRes.json();
    console.log('Resposta do Asaas ao buscar o Installment:', installmentData);
    
    if (installmentData.paymentBookUrl) {
      console.log(`URL do carnê encontrada: ${installmentData.paymentBookUrl}`);
      return res.status(200).json({ status: 'success', type: 'pdf', url: installmentData.paymentBookUrl });
    } else {
      console.log(`Installment ${installmentId} não possui paymentBookUrl. Acionando Plano B (buscando parcelas).`);
      
      // Plano B: Buscar todas as cobranças deste installment no Supabase
      const { data: cobrancas, error: dbError } = await supabase
        .from('alunos_cobrancas')
        .select('id, asaas_payment_id, vencimento, valor, link_boleto, status, installment, asaas_installment_id')
        .or(`installment.eq.${installmentId},asaas_installment_id.eq.${installmentId}`)
        .order('vencimento', { ascending: true });

      if (dbError) {
        console.error('Erro ao buscar parcelas no Supabase:', dbError);
        return res.status(500).json({ status: 'error', error: 'Erro ao buscar parcelas do carnê.' });
      }

      if (!cobrancas || cobrancas.length === 0) {
        return res.status(404).json({ status: 'error', error: 'Nenhuma parcela encontrada para este carnê.' });
      }

      // Format the response for the frontend modal
      const boletos = cobrancas.map((c, index) => ({
        id: c.id,
        numero: index + 1,
        vencimento: c.vencimento,
        valor: c.valor,
        linkBoleto: c.link_boleto,
        status: c.status,
        installment: c.installment
      }));

      return res.status(200).json({ 
        status: 'success',
        type: 'fallback', 
        boletos,
        message: 'Link único do carnê indisponível. Utilize os boletos individuais.'
      });
    }

  } catch (error) {
    console.error('Erro ao buscar carnê:', error);
    return res.status(500).json({ error: 'Erro interno ao processar o carnê.' });
  }
});

// Rota antiga mantida para compatibilidade (se necessário)
app.get('/api/alunos/:id/carne', async (req, res) => {
  try {
    const alunoId = req.params.id;

    // 1. Buscar a cobrança mais recente do aluno que tenha um installment válido
    console.log(`Buscando carnê para o aluno: ${alunoId}`);
    const { data: cobrancas, error: dbError } = await supabase
      .from('alunos_cobrancas')
      .select('installment, asaas_installment_id')
      .eq('aluno_id', alunoId)
      .or('installment.not.is.null,asaas_installment_id.not.is.null')
      .order('vencimento', { ascending: false })
      .limit(1);

    if (dbError) {
      console.error('Erro ao buscar cobranças no Supabase:', dbError);
      return res.status(500).json({ error: 'Erro ao buscar dados no banco de dados.' });
    }

    if (!cobrancas || cobrancas.length === 0 || (!cobrancas[0].installment && !cobrancas[0].asaas_installment_id)) {
      console.log(`Nenhum installment encontrado para o aluno: ${alunoId}`);
      return res.status(400).json({ 
        error: 'Não é possível gerar um carnê único para cobranças avulsas ou o aluno não possui parcelamentos.' 
      });
    }

    const installmentId = cobrancas[0].asaas_installment_id || cobrancas[0].installment;
    console.log(`Installment encontrado: ${installmentId}`);

    // 2. Buscar detalhes do parcelamento no Asaas
    const installmentRes = await fetch(`https://sandbox.asaas.com/api/v3/installments/${installmentId}`, {
      method: 'GET',
      headers: {
        'access_token': process.env.ASAAS_API_KEY
      }
    });

    if (!installmentRes.ok) {
      const errorData = await installmentRes.json();
      console.error(`Erro ao buscar installment ${installmentId} no Asaas:`, errorData);
      return res.status(500).json({ error: 'Erro ao buscar dados do carnê no Asaas.' });
    }

    const installmentData = await installmentRes.json();
    console.log('Resposta do Asaas ao buscar o Installment:', installmentData);
    
    if (installmentData.paymentBookUrl) {
      console.log(`URL do carnê encontrada: ${installmentData.paymentBookUrl}`);
      return res.status(200).json({ status: 'success', type: 'pdf', url: installmentData.paymentBookUrl });
    } else {
      console.log(`Installment ${installmentId} não possui paymentBookUrl. Acionando Plano B (buscando parcelas).`);
      
      // Plano B: Buscar todas as cobranças deste installment no Supabase
      const { data: parcelasData, error: parcelasError } = await supabase
        .from('alunos_cobrancas')
        .select('id, asaas_payment_id, vencimento, valor, link_boleto, status, installment, asaas_installment_id')
        .or(`installment.eq.${installmentId},asaas_installment_id.eq.${installmentId}`)
        .order('vencimento', { ascending: true });

      if (parcelasError) {
        console.error('Erro ao buscar parcelas no Supabase:', parcelasError);
        return res.status(500).json({ status: 'error', error: 'Erro ao buscar parcelas do carnê.' });
      }

      if (!parcelasData || parcelasData.length === 0) {
        return res.status(404).json({ status: 'error', error: 'Nenhuma parcela encontrada para este carnê.' });
      }

      // Format the response for the frontend modal
      const boletos = parcelasData.map((c, index) => ({
        id: c.id,
        numero: index + 1,
        vencimento: c.vencimento,
        valor: c.valor,
        linkBoleto: c.link_boleto,
        status: c.status,
        installment: c.installment
      }));

      return res.status(200).json({ 
        status: 'success',
        type: 'fallback', 
        boletos,
        message: 'Link único do carnê indisponível. Utilize os boletos individuais.'
      });
    }

  } catch (error) {
    console.error('Erro ao buscar carnê:', error);
    return res.status(500).json({ error: 'Erro interno ao processar o carnê.' });
  }
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

// --- LÓGICA DE INICIALIZAÇÃO CORRIGIDA ---
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('API Operante no AI Studio!'));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
