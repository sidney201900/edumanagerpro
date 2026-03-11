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

    if (parcelas && parcelas > 1) {
      asaasPayload.installmentCount = parcelas;
      asaasPayload.installmentValue = valor;
    } else {
      asaasPayload.value = valor;
    }

    const fineValue = parseFloat(multa);
    const interestValue = parseFloat(juros);
    const discountValue = parseFloat(desconto);

    if (!isNaN(fineValue) && fineValue > 0) asaasPayload.fine = { value: fineValue, type: 'PERCENTAGE' };
    if (!isNaN(interestValue) && interestValue > 0) asaasPayload.interest = { value: interestValue, type: 'PERCENTAGE' };
    if (!isNaN(discountValue) && discountValue > 0) asaasPayload.discount = { value: discountValue, dueDateLimitDays: 0, type: 'FIXED' };

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

    // 3. Save to Supabase (Initial charge or first installment)
    const paymentId = paymentData.id || (paymentData.installments && paymentData.installments[0].id);
    const bankSlipUrl = paymentData.bankSlipUrl || (paymentData.installments && paymentData.installments[0].bankSlipUrl);

    const { error: dbError } = await supabase
      .from('alunos_cobrancas')
      .insert([{
        aluno_id: aluno_id,
        asaas_customer_id: customerId,
        asaas_payment_id: paymentId,
        valor: valor,
        vencimento: vencimento,
        link_boleto: bankSlipUrl
      }]);

    if (dbError) {
      console.error('Supabase Insert Error:', dbError);
      throw new Error('Falha ao salvar no banco de dados');
    }

    return res.status(200).json({ 
      bankSlipUrl: bankSlipUrl,
      paymentId: paymentId
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
app.get('/api/alunos/:id/carne', async (req, res) => {
  try {
    const alunoId = req.params.id;

    // 1. Buscar a cobrança mais recente do aluno para pegar o ID do Asaas
    const { data, error: dbError } = await supabase
      .from('alunos_cobrancas')
      .select('asaas_payment_id')
      .eq('aluno_id', alunoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (dbError || !data) {
      console.error('Cobrança não encontrada para o aluno:', alunoId, dbError);
      return res.status(404).json({ error: 'Nenhuma cobrança encontrada para este aluno.' });
    }

    const asaasPaymentId = data.asaas_payment_id;

    // 2. Buscar detalhes do pagamento no Asaas
    const paymentRes = await fetch(`https://sandbox.asaas.com/api/v3/payments/${asaasPaymentId}`, {
      method: 'GET',
      headers: {
        'access_token': process.env.ASAAS_API_KEY
      }
    });

    if (!paymentRes.ok) {
      const errorData = await paymentRes.json();
      console.error('Erro ao buscar pagamento no Asaas:', errorData);
      return res.status(500).json({ error: 'Erro ao buscar dados no Asaas.' });
    }

    const paymentData = await paymentRes.json();

    // 3. Se for um parcelamento, buscar o carnê do parcelamento
    if (paymentData.installment) {
      const installmentRes = await fetch(`https://sandbox.asaas.com/api/v3/installments/${paymentData.installment}`, {
        method: 'GET',
        headers: {
          'access_token': process.env.ASAAS_API_KEY
        }
      });

      if (installmentRes.ok) {
        const installmentData = await installmentRes.json();
        if (installmentData.paymentBookUrl) {
          return res.status(200).json({ url: installmentData.paymentBookUrl });
        }
      }
    }

    // 4. Se não for parcelamento ou não tiver carnê, retorna o link do boleto individual
    if (paymentData.bankSlipUrl) {
      return res.status(200).json({ url: paymentData.bankSlipUrl });
    }

    return res.status(404).json({ error: 'Link do carnê ou boleto não disponível.' });

  } catch (error) {
    console.error('Erro ao buscar carnê:', error);
    return res.status(500).json({ error: 'Erro interno ao processar o carnê.' });
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
