const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método não permitido' };
  }

  try {
    const { aluno_id, valor, vencimento } = JSON.parse(event.body);

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_KEY
    );

    // Busca o asaas_payment_id correspondente
    const { data, error: selectError } = await supabase
      .from('alunos_cobrancas')
      .select('asaas_payment_id')
      .eq('aluno_id', aluno_id)
      .eq('valor', valor)
      .eq('vencimento', vencimento)
      .single();

    if (selectError || !data) {
      console.error('Cobrança não encontrada no Supabase:', selectError);
      return { statusCode: 404, body: 'Cobrança não encontrada' };
    }

    const asaasPaymentId = data.asaas_payment_id;

    // Deleta no Asaas
    const asaasResponse = await fetch(`https://sandbox.asaas.com/api/v3/payments/${asaasPaymentId}`, {
      method: 'DELETE',
      headers: {
        'access_token': process.env.ASAAS_API_KEY
      }
    });

    if (!asaasResponse.ok && asaasResponse.status !== 404) {
      const errorText = await asaasResponse.text();
      console.error('Erro ao deletar no Asaas:', errorText);
      // Mesmo se falhar no Asaas (ex: já deletado), tentamos deletar no Supabase
    }

    // Deleta no Supabase
    const { error: deleteError } = await supabase
      .from('alunos_cobrancas')
      .delete()
      .eq('asaas_payment_id', asaasPaymentId);

    if (deleteError) {
      console.error('Erro ao deletar no Supabase:', deleteError);
      return { statusCode: 500, body: 'Erro ao deletar no banco de dados' };
    }

    return { statusCode: 200, body: JSON.stringify({ message: 'Sucesso ao excluir cobrança' }) };

  } catch (error) {
    console.error('Erro na função excluir_cobranca:', error);
    return { statusCode: 500, body: 'Erro interno' };
  }
};
