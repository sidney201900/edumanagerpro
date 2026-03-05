const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // 1. Verifica se é POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método não permitido' };
  }

  // 2. NOVA TRAVA DE SEGURANÇA: Verifica o Token do Asaas
  const tokenRecebido = event.headers['asaas-access-token'];
  if (tokenRecebido !== process.env.ASAAS_WEBHOOK_TOKEN) {
    console.error('Tentativa de acesso negada: Token do webhook inválido!');
    return { statusCode: 401, body: 'Não autorizado' }; // 401 = Acesso negado
  }

  try {
    const payload = JSON.parse(event.body);
    const asaasPaymentId = payload.payment.id;

    // Conectamos ao Supabase
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL, 
      process.env.VITE_SUPABASE_KEY
    );

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
        return { statusCode: 200, body: 'Evento ignorado' };
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

    // Retorna Sucesso para o Asaas
    return { statusCode: 200, body: 'Webhook processado com sucesso' };

  } catch (error) {
    console.error('Erro no Webhook:', error);
    return { statusCode: 500, body: 'Erro interno' };
  }
};
