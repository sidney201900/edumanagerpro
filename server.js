import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Supabase Setup
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
          installment: installmentId, // Obrigatoriamente preenchido com o ID do pacote
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

// Excluir Cobrança
app.post('/api/excluir_cobranca', async (req, res) => {
  try {
    const { aluno_id, valor, vencimento } = req.body;

    const { data, error: selectError } = await supabase
      .from('alunos_cobrancas')
      .select('asaas_payment_id')
      .eq('aluno_id', aluno_id)
      .eq('valor', valor)
      .eq('vencimento', vencimento)
      .single();

    if (selectError || !data) {
      console.error('Cobrança não encontrada no Supabase:', selectError);
      return res.status(404).json({ error: 'Cobrança não encontrada' });
    }

    const asaasPaymentId = data.asaas_payment_id;

    const asaasResponse = await fetch(`https://sandbox.asaas.com/api/v3/payments/${asaasPaymentId}`, {
      method: 'DELETE',
      headers: {
        'access_token': process.env.ASAAS_API_KEY
      }
    });

    let asaasDeleted = false;
    let asaasErrorMessage = '';

    if (asaasResponse.ok || asaasResponse.status === 404) {
      asaasDeleted = true;
    } else {
      const errorData = await asaasResponse.json().catch(() => ({}));
      asaasErrorMessage = errorData.errors?.[0]?.description || 'Erro desconhecido no Asaas';
      console.error('Erro ao deletar no Asaas:', asaasErrorMessage);
    }

    // Deletar do Supabase independente do sucesso no Asaas (conforme solicitado: permitir excluir se necessário)
    const { error: deleteError } = await supabase
      .from('alunos_cobrancas')
      .delete()
      .eq('asaas_payment_id', asaasPaymentId);

    if (deleteError) {
      console.error('Erro ao deletar no Supabase:', deleteError);
      return res.status(500).json({ error: 'Erro ao deletar no banco de dados' });
    }

    if (!asaasDeleted) {
      return res.status(200).json({ 
        message: 'Excluído apenas no sistema local.',
        asaasError: asaasErrorMessage 
      });
    }

    return res.status(200).json({ message: 'Cobrança cancelada com sucesso no Asaas e no sistema' });

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
      return res.status(200).json({ url: installmentData.paymentBookUrl });
    } else {
      console.log(`Installment ${installmentId} não possui paymentBookUrl. Acionando Plano B (buscando parcelas).`);
      
      // Plano B: Buscar todas as cobranças deste installment no Supabase
      const { data: cobrancas, error: dbError } = await supabase
        .from('alunos_cobrancas')
        .select('id, asaas_payment_id, vencimento, valor, link_boleto, status')
        .eq('installment', installmentId)
        .order('vencimento', { ascending: true });

      if (dbError) {
        console.error('Erro ao buscar parcelas no Supabase:', dbError);
        return res.status(500).json({ error: 'Erro ao buscar parcelas do carnê.' });
      }

      if (!cobrancas || cobrancas.length === 0) {
        return res.status(404).json({ error: 'Nenhuma parcela encontrada para este carnê.' });
      }

      // Format the response for the frontend modal
      const parcelas = cobrancas.map((c, index) => ({
        id: c.id,
        numero: index + 1,
        vencimento: c.vencimento,
        valor: c.valor,
        linkBoleto: c.link_boleto,
        status: c.status
      }));

      return res.status(200).json({ 
        fallback: true, 
        parcelas,
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
      .select('installment')
      .eq('aluno_id', alunoId)
      .not('installment', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (dbError) {
      console.error('Erro ao buscar cobranças no Supabase:', dbError);
      return res.status(500).json({ error: 'Erro ao buscar dados no banco de dados.' });
    }

    if (!cobrancas || cobrancas.length === 0 || !cobrancas[0].installment) {
      console.log(`Nenhum installment encontrado para o aluno: ${alunoId}`);
      return res.status(400).json({ 
        error: 'Não é possível gerar um carnê único para cobranças avulsas ou o aluno não possui parcelamentos.' 
      });
    }

    const installmentId = cobrancas[0].installment;
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
      return res.status(200).json({ url: installmentData.paymentBookUrl });
    } else {
      console.log(`Installment ${installmentId} não possui paymentBookUrl. Acionando Plano B (buscando parcelas).`);
      
      // Plano B: Buscar todas as cobranças deste installment no Supabase
      const { data: parcelasData, error: parcelasError } = await supabase
        .from('alunos_cobrancas')
        .select('id, asaas_payment_id, vencimento, valor, link_boleto, status')
        .eq('installment', installmentId)
        .order('vencimento', { ascending: true });

      if (parcelasError) {
        console.error('Erro ao buscar parcelas no Supabase:', parcelasError);
        return res.status(500).json({ error: 'Erro ao buscar parcelas do carnê.' });
      }

      if (!parcelasData || parcelasData.length === 0) {
        return res.status(404).json({ error: 'Nenhuma parcela encontrada para este carnê.' });
      }

      // Format the response for the frontend modal
      const parcelas = parcelasData.map((c, index) => ({
        id: c.id,
        numero: index + 1,
        vencimento: c.vencimento,
        valor: c.valor,
        linkBoleto: c.link_boleto,
        status: c.status
      }));

      return res.status(200).json({ 
        fallback: true, 
        parcelas,
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

        // 2. Deletar no Supabase (mesmo se falhar no Asaas, para manter sincronia se o usuário forçar)
        const { error: dbError } = await supabase
          .from('alunos_cobrancas')
          .delete()
          .eq('asaas_payment_id', id);

        return { id, success: asaasRes.ok || asaasRes.status === 404, dbSuccess: !dbError };
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

// Servir o Frontend
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback do React Router com Regex nativa
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
