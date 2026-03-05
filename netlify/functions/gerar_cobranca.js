import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { 
      aluno_id, nome, cpf, email, valor, vencimento, multa, juros, desconto,
      telefone, cep, endereco, numero, bairro, descricao
    } = JSON.parse(event.body);

    // 1. Create Asaas Customer
    const asaasCustomerRes = await fetch('https://sandbox.asaas.com/api/v3/customers', {
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

    if (!asaasCustomerRes.ok) {
      const errorData = await asaasCustomerRes.json();
      console.error('Asaas Customer Error:', errorData);
      throw new Error('Falha ao criar cliente no Asaas');
    }

    const customerData = await asaasCustomerRes.json();
    const customerId = customerData.id;

    // 2. Create Asaas Payment (Boleto)
    const asaasPayload = {
      customer: customerId,
      billingType: 'BOLETO',
      dueDate: vencimento, // String pura YYYY-MM-DD recebida do front
      value: valor, // Valor cheio, sem subtrair o desconto
      description: descricao ? `${descricao} - Microtec Informática Cursos` : 'Mensalidade - Microtec Informática Cursos'
    };

    // Só adiciona se for maior que zero
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

    // 3. Save to Supabase
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error: dbError } = await supabase
      .from('alunos_cobrancas')
      .insert([{
        aluno_id: aluno_id,
        asaas_customer_id: customerId,
        asaas_payment_id: paymentData.id,
        valor: valor,
        vencimento: vencimento,
        link_boleto: paymentData.bankSlipUrl
      }]);

    if (dbError) {
      console.error('Supabase Insert Error:', dbError);
      throw new Error('Falha ao salvar no banco de dados');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        bankSlipUrl: paymentData.bankSlipUrl,
        paymentId: paymentData.id
      })
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
