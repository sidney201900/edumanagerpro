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
        updateData = { status: 'PAGO' };
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

    // 1. Create Asaas Customer
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
      throw new Error('Falha ao criar cliente no Asaas');
    }

    const customerData = await customerRes.json();
    const customerId = customerData.id;

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

    if (multa > 0) asaasPayload.fine = { value: multa, type: 'PERCENTAGE' };
    if (juros > 0) asaasPayload.interest = { value: juros, type: 'PERCENTAGE' };
    if (desconto > 0) asaasPayload.discount = { value: desconto, dueDateLimitDays: 0, type: 'FIXED' };

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
      throw new Error('Falha ao criar cobrança no Asaas');
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

    if (!asaasResponse.ok && asaasResponse.status !== 404) {
      const errorText = await asaasResponse.text();
      console.error('Erro ao deletar no Asaas:', errorText);
    }

    const { error: deleteError } = await supabase
      .from('alunos_cobrancas')
      .delete()
      .eq('asaas_payment_id', asaasPaymentId);

    if (deleteError) {
      console.error('Erro ao deletar no Supabase:', deleteError);
      return res.status(500).json({ error: 'Erro ao deletar no banco de dados' });
    }

    return res.status(200).json({ message: 'Sucesso ao excluir cobrança' });

  } catch (error) {
    console.error('Erro na função excluir_cobranca:', error);
    return res.status(500).json({ error: 'Erro interno' });
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
