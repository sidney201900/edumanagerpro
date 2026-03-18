import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SchoolData, Payment, Student } from '../types';
import { useDialog } from '../DialogContext';
import SearchableSelect from './SearchableSelect';
import { CheckCircle, Clock, AlertCircle, RefreshCw, Filter, Plus, X, Printer, Tag, Hash, User, BookOpen, Trash2, Eye, Barcode, Receipt, Layers, ChevronUp, ChevronDown } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../services/supabase';

interface FinanceProps { data: SchoolData; updateData: (newData: Partial<SchoolData>) => void; }

const Finance: React.FC<FinanceProps> = ({ data, updateData }) => {
  const { showAlert } = useDialog();
  const [filterStatus, setFilterStatus] = useState<'all'|'pending'|'paid'|'overdue'>('all');
  const [filterType, setFilterType] = useState<'all'|'avulsas'|'parcelamentos'>('all');
  const [expandedInst, setExpandedInst] = useState<string[]>([]);
  const [filterStudent, setFilterStudent] = useState<string>('all');
  const [filterClass, setFilterClass] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showHist, setShowHist] = useState(false);
  const [showDel, setShowDel] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [selHist, setSelHist] = useState<Student | null>(null);
  const [selCarne, setSelCarne] = useState<string>('');
  const [payToDel, setPayToDel] = useState<Payment | null>(null);
  const [isSync, setIsSync] = useState(false);
  const [isFetchCarne, setIsFetchCarne] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [fallbackInst, setFallbackInst] = useState<any[]>([]);

  useEffect(() => { syncAsaas(); }, []);
  const dataRef = useRef(data.payments);
  useEffect(() => { dataRef.current = data.payments; }, [data.payments]);

  const handleLink = async (id: string, type: 'boleto'|'recibo'|'carne') => {
    if (!id) return showAlert('Erro', 'ID inválido para esta operação.', 'error');
    try {
      showAlert('Aguarde', `Buscando ${type}...`, 'info');
      if (type === 'carne') {
        const res = await fetch(`/api/parcelamentos/${id}/carne`);
        const result = await res.json();
        if (res.ok) {
          if (result.type === 'fallback') { setFallbackInst(result.boletos); setShowFallback(true); showAlert('Atenção', result.message, 'info'); } 
          else if (result.url) { window.open(result.url, '_blank'); showAlert('Sucesso', 'Carnê localizado!', 'success'); }
        } else showAlert('Erro', result.error || 'Falha ao buscar', 'error');
        return;
      }
      const res = await fetch(`/api/cobrancas/${id}/link`);
      const result = await res.json();
      if (res.ok) {
        const url = type === 'boleto' ? result.bankSlipUrl : result.transactionReceiptUrl;
        if (url) window.open(url, '_blank'); else showAlert('Atenção', 'Indisponível no momento.', 'warning');
      } else showAlert('Erro', result.error || 'Falha', 'error');
    } catch (e) { showAlert('Erro', 'Erro ao processar.', 'error'); }
  };

  const handlePrint = async (stdId: string) => {
    setIsFetchCarne(true);
    try {
      const res = await fetch(`/api/alunos/${stdId}/carne`);
      const result = await res.json();
      if (res.ok) {
        if (result.type === 'fallback') { setFallbackInst(result.boletos); setShowFallback(true); showAlert('Atenção', result.message, 'info'); } 
        else if (result.url) { window.open(result.url, '_blank'); showAlert('Sucesso', 'Carnê localizado!', 'success'); }
      } else showAlert('Atenção', result.error || 'Não encontrado.', 'warning');
    } catch (e) { showAlert('Erro', 'Erro interno.', 'error'); } 
    finally { setIsFetchCarne(false); }
  };

  const syncAsaas = async () => {
    if (!isSupabaseConfigured() || isSync) return;
    setIsSync(true);
    try {
      const { data: cp, error } = await supabase.from('alunos_cobrancas').select('*');
      if (error) throw error;
      if (cp && cp.length > 0) {
        let count = 0;
        const current = dataRef.current;
        const updated = current.map(p => {
          const m = cp.find(c => p.asaasPaymentId ? c.asaas_payment_id === p.asaasPaymentId : (c.aluno_id === p.studentId && Math.abs(c.valor - p.amount) < 0.01 && c.vencimento === p.dueDate));
          if (m) {
            const st = (m.status || '').toLowerCase();
            const nSt = st === 'pago' ? 'paid' : st === 'atrasado' ? 'overdue' : st === 'cancelado' ? 'cancelled' : 'pending';
            if (p.status !== nSt || p.installmentId !== (m.asaas_installment_id || m.installment) || p.asaasPaymentId !== m.asaas_payment_id) {
              count++;
              return { ...p, status: nSt as any, amount: m.valor, paidDate: m.data_pagamento || p.paidDate, installmentId: m.asaas_installment_id || m.installment || p.installmentId, asaasPaymentUrl: m.link_boleto || p.asaasPaymentUrl, asaasPaymentId: m.asaas_payment_id || p.asaasPaymentId };
            }
          }
          return p;
        });
        if (count > 0) { updateData({ payments: updated }); showAlert('Sincronização', `${count} itens atualizados.`, 'success'); }
      }
    } catch (e) {} finally { setIsSync(false); }
  };

  const [manualInst, setManualInst] = useState(1);
  const [dueDisp, setDueDisp] = useState(new Date().toLocaleDateString('pt-BR'));
  const [selItem, setSelItem] = useState('');
  const [formData, setFormData] = useState({ studentId: '', amount: 150, discount: 0, fine: 0, interest: 0, dueDate: new Date().toISOString().split('T')[0], type: 'monthly', description: '' });

  useEffect(() => {
    if (formData.studentId) {
      const st = data.students.find(s => s.id === formData.studentId);
      if (st) {
        let f = 0, i = 0;
        if (selItem.startsWith('course_')) { const c = data.courses.find(x => x.id === selItem.replace('course_','')); f = c?.finePercentage||0; i = c?.interestPercentage||0; } 
        else if (selItem.startsWith('handout_')) { const h = data.handouts?.find(x => x.id === selItem.replace('handout_','')); f = h?.finePercentage||0; i = h?.interestPercentage||0; } 
        else { const cl = data.classes.find(x => x.id === st.classId); const c = data.courses.find(x => x.id === cl?.courseId); f = c?.finePercentage||0; i = c?.interestPercentage||0; }
        setFormData(p => ({ ...p, fine: f, interest: i }));
      }
    }
  }, [formData.studentId, selItem, data]);

  const fMask = (v: string) => v.replace(/\D/g, '').replace(/(\d{2})(\d)/, '$1/$2').replace(/(\d{2})(\d)/, '$1/$2').slice(0, 10);
  const isoDt = (br: string) => br.length===10 ? `${br.split('/')[2]}-${br.split('/')[1]}-${br.split('/')[0]}` : '';

  const filtP = data.payments.filter(p => {
    const s1 = filterStatus === 'all' || p.status === filterStatus;
    const s2 = filterStudent === 'all' || p.studentId === filterStudent;
    const cl = filterClass === 'all' || data.students.find(s=>s.id===p.studentId)?.classId === filterClass;
    const tp = filterType === 'all' || (filterType === 'avulsas' && !p.installmentId) || (filterType === 'parcelamentos' && !!p.installmentId);
    return s1 && s2 && cl && tp;
  }).sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const groups = useMemo(() => {
    if (filterType !== 'parcelamentos') return [];
    const grps: Record<string, Payment[]> = {};
    filtP.forEach(p => { if (p.installmentId) { if (!grps[p.installmentId]) grps[p.installmentId] = []; grps[p.installmentId].push(p); } });
    return Object.entries(grps).map(([id, pts]) => {
      const s = pts.sort((a, b) => (a.installmentNumber||0) - (b.installmentNumber||0));
      return { id, pts: s, stId: s[0].studentId, tot: s.reduce((a,b)=>a+b.amount,0), desc: s[0].description?.split(' (')[0]||'Carnê' };
    }).sort((a, b) => new Date(b.pts[0].dueDate).getTime() - new Date(a.pts[0].dueDate).getTime());
  }, [filtP, filterType]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.studentId || formData.amount <= 0) return showAlert('Atenção', 'Selecione aluno e valor', 'warning');
    const st = data.students.find(s => s.id === formData.studentId);
    if (!st) return;

    const nP: Payment[] = [];
    const bD = new Date(dueDisp.length === 10 ? isoDt(dueDisp) : formData.dueDate);

    for (let i = 0; i < manualInst; i++) {
      const d = new Date(bD); d.setMonth(bD.getMonth() + i);
      nP.push({ ...formData, lateFee: formData.fine, dueDate: d.toISOString().split('T')[0], id: crypto.randomUUID(), amount: formData.amount, status: 'pending', installmentNumber: manualInst>1?i+1:undefined, totalInstallments: manualInst>1?manualInst:undefined, description: manualInst>1?`${formData.description} (${i+1}/${manualInst})`:formData.description } as any);
    }

    try {
      const res = await fetch('/api/gerar_cobranca', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aluno_id: st.id, nome: st.name, cpf: (st.cpf||st.guardianCpf||'').replace(/\D/g,''), email: st.email, valor: formData.amount, vencimento: nP[0].dueDate, multa: formData.fine, juros: formData.interest, desconto: formData.discount, telefone: st.phone, cep: st.addressZip, endereco: st.addressStreet, numero: st.addressNumber, bairro: st.addressNeighborhood, descricao: formData.description, parcelas: manualInst })
      });
      if (res.ok) {
        const ad = await res.json();
        if (ad.payments?.length > 0) {
          nP.forEach((p, i) => { const ap = ad.payments[i]||ad.payments[ad.payments.length-1]; p.asaasPaymentUrl = ap.link_boleto; p.asaasPaymentId = ap.asaas_payment_id; if (ad.installment) p.installmentId = ad.installment; });
        }
      }
    } catch (e) { showAlert('Aviso', 'Salvo só local.', 'warning'); }
    updateData({ payments: [...data.payments, ...nP] });
    showAlert('Sucesso', 'Gerado!', 'success'); closeMod();
  };

  const closeMod = () => {
    setIsClosing(true);
    setTimeout(() => { setIsModalOpen(false); setShowHist(false); setShowDel(false); setIsClosing(false); setManualInst(1); setDueDisp(new Date().toLocaleDateString('pt-BR')); setFormData({ studentId: '', amount: 150, discount: 0, fine: 0, interest: 0, dueDate: new Date().toISOString().split('T')[0], type: 'monthly', description: '' }); setSelHist(null); setPayToDel(null); }, 300);
  };

  const del = async (type: 'single' | 'all') => {
    if (!payToDel) return;
    
    // AQUI ESTÁ A MÁGICA DA EXCLUSÃO: Se for 'all', ele pega o installmentId. Se for 'single', pega o asaasPaymentId.
    const id = type === 'all' ? (payToDel.installmentId || (payToDel as any).asaasIdParaExcluir || payToDel.id) : (payToDel.asaasPaymentId || payToDel.id);
    
    if (!id) return showAlert('Erro', 'ID não encontrado', 'error');
    try {
      showAlert('Aguarde', 'Limpando Asaas e Banco de Dados...', 'info');
      const res = await fetch('/api/excluir_cobranca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (res.ok) {
        showAlert('Sucesso', 'Excluído no sistema e Asaas.', 'success');
        updateData({ payments: data.payments.filter(p => p.id !== id && p.installmentId !== id && p.asaasPaymentId !== id) });
      } else showAlert('Aviso', 'Erro na exclusão.', 'warning');
    } catch (e) { showAlert('Erro', 'Falha ao conectar.', 'error'); }
    closeMod();
  };

  const bge = (p: Payment) => {
    const s = (p.status || '').toLowerCase();
    if (s==='paid'||s==='pago'||s==='received') return <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase"><CheckCircle size={12}/> Pago</span>;
    if (s==='overdue'||s==='atrasado') return <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase"><AlertCircle size={12}/> Atrasado</span>;
    return <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase"><Clock size={12}/> Pendente</span>;
  };

  const inpCls = "px-4 py-2 bg-white border border-slate-300 rounded-lg text-xs w-full";

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex justify-between items-center">
        <div><h2 className="text-3xl font-extrabold text-slate-900">Financeiro</h2><p className="text-slate-500 text-sm">Gestão de cobranças</p></div>
        <div className="flex gap-2">
          <button onClick={()=>setShowPrint(true)} className="bg-white text-indigo-600 border border-indigo-200 px-6 py-3 rounded-xl flex gap-2 font-bold"><Printer size={20} /> Imprimir Carnê</button>
          <button onClick={()=>setIsModalOpen(true)} className="bg-indigo-600 text-white px-6 py-3 rounded-xl flex gap-2 font-bold"><Plus size={20} /> Lançamento</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-6 bg-slate-50 border-b flex flex-wrap gap-4">
           <select className={inpCls+" w-auto"} value={filterType} onChange={e=>setFilterType(e.target.value as any)}><option value="all">Todas</option><option value="avulsas">Avulsas</option><option value="parcelamentos">Carnês</option></select>
           <select className={inpCls+" w-auto"} value={filterStatus} onChange={e=>setFilterStatus(e.target.value as any)}><option value="all">Todos Status</option><option value="pending">Pendentes</option><option value="paid">Pagos</option><option value="overdue">Atrasados</option></select>
           <select className={inpCls+" w-auto"} value={filterClass} onChange={e=>{setFilterClass(e.target.value); setFilterStudent('all');}}><option value="all">Turmas</option>{data.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
           <select className={inpCls+" w-auto"} value={filterStudent} onChange={e=>setFilterStudent(e.target.value)}><option value="all">Alunos</option>{data.students.filter(s=>filterClass==='all'||s.classId===filterClass).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left"><thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black"><tr><th className="p-4">Descrição</th><th className="p-4">Vencimento</th><th className="p-4">Valor</th><th className="p-4">Status</th><th className="p-4 text-right">Ação</th></tr></thead>
            <tbody>
              {filterType === 'parcelamentos' ? groups.map(g => (
                <React.Fragment key={g.id}>
                  <tr className="bg-slate-50 border-b"><td className="p-4 font-bold">{data.students.find(s=>s.id===g.stId)?.name}<div className="text-[10px] text-indigo-500">CARNÊ {g.pts.length}X</div><div className="text-[10px] font-normal text-slate-400">{g.desc}</div></td><td className="p-4 text-sm">{new Date(g.pts[g.pts.length-1].dueDate).toLocaleDateString('pt-BR')}</td><td className="p-4 font-black">R$ {g.tot.toFixed(2)}</td><td className="p-4"><Layers size={14} className="inline"/></td><td className="p-4 text-right flex justify-end gap-2"><button onClick={()=>setExpandedInst(p=>p.includes(g.id)?p.filter(x=>x!==g.id):[...p, g.id])} className="px-3 py-1 bg-white border rounded text-xs font-bold">Ver</button><button onClick={()=>handleLink(g.id,'carne')} className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-bold"><Printer size={14}/></button><button onClick={()=>{setPayToDel({...g.pts[0], id:g.id, installmentId:g.id, asaasIdParaExcluir:g.id} as any); setShowDel(true);}} className="text-red-400 hover:text-red-600"><Trash2 size={16}/></button></td></tr>
                  {expandedInst.includes(g.id) && g.pts.map(p => (
                    <tr key={p.id} className="border-b bg-white"><td className="p-4 pl-10 text-[10px] uppercase text-slate-500">Parc. {p.installmentNumber}</td><td className="p-4 text-sm">{new Date(p.dueDate).toLocaleDateString('pt-BR')}</td><td className="p-4 font-bold">R$ {p.amount.toFixed(2)}</td><td className="p-4">{bge(p)}</td><td className="p-4 text-right flex justify-end gap-2">{p.asaasPaymentId && <button onClick={()=>handleLink(p.asaasPaymentId!,'boleto')} className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold"><Barcode size={12}/> Boleto</button>}<button onClick={()=>{setPayToDel(p); setShowDel(true);}} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button></td></tr>
                  ))}
                </React.Fragment>
              )) : filtP.map(p => (
                <tr key={p.id} className="border-b hover:bg-slate-50"><td className="p-4 font-bold">{data.students.find(s=>s.id===p.studentId)?.name}<div className="text-[10px] text-slate-400">{p.description}</div></td><td className="p-4 text-sm">{new Date(p.dueDate).toLocaleDateString('pt-BR')}</td><td className="p-4 font-black">R$ {p.amount.toFixed(2)}</td><td className="p-4">{bge(p)}</td><td className="p-4 text-right flex justify-end gap-2">{p.asaasPaymentId && <button onClick={()=>handleLink(p.asaasPaymentId!,'boleto')} className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold"><Barcode size={12}/> Boleto</button>}<button onClick={()=>{setPayToDel(p); setShowDel(true);}} className="text-red-400 hover:text-red-600"><Trash2 size={16}/></button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FORMULÁRIO COMPLETO E COM TODOS OS CAMPOS */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 overflow-y-auto"><div className="bg-white p-6 rounded-xl w-full max-w-lg mt-10"><h3 className="text-xl font-black mb-4">Novo Lançamento</h3><form onSubmit={handleCreate} className="space-y-4">
          <SearchableSelect label="Aluno" options={data.students.map(s=>({id:s.id,name:s.name}))} value={formData.studentId} onChange={v=>setFormData({...formData,studentId:v})} required/>
          <select className={inpCls} value={selItem} onChange={e=>{setSelItem(e.target.value); setFormData({...formData, description: e.target.options[e.target.selectedIndex].text});}}><option value="">Personalizado</option><optgroup label="Cursos">{data.courses.map(c=><option key={c.id} value={`course_${c.id}`}>{c.name}</option>)}</optgroup></select>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-bold text-slate-400 uppercase">Valor Base (R$)</label><input className={inpCls} type="number" step="0.01" value={formData.amount} onChange={e=>setFormData({...formData,amount:Number(e.target.value)})} /></div>
            <div><label className="text-[10px] font-bold text-slate-400 uppercase">Qtd Parcelas</label><input className={inpCls} type="number" value={manualInst} onChange={e=>setManualInst(Number(e.target.value))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-bold text-slate-400 uppercase">Desconto (R$)</label><input className={inpCls} type="number" step="0.01" value={formData.discount} onChange={e=>setFormData({...formData,discount:Number(e.target.value)})} /></div>
            <div><label className="text-[10px] font-bold text-slate-400 uppercase">Vencimento (DD/MM/AAAA)</label><input className={inpCls} value={dueDisp} onChange={e=>{setDueDisp(fMask(e.target.value)); if(e.target.value.length===10) setFormData({...formData, dueDate: isoDt(e.target.value)})}} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-bold text-slate-400 uppercase">Multa (%)</label><input className={inpCls} type="number" step="0.01" value={formData.fine} onChange={e=>setFormData({...formData,fine:Number(e.target.value)})} /></div>
            <div><label className="text-[10px] font-bold text-slate-400 uppercase">Juros ao Mês (%)</label><input className={inpCls} type="number" step="0.01" value={formData.interest} onChange={e=>setFormData({...formData,interest:Number(e.target.value)})} /></div>
          </div>
          <div><label className="text-[10px] font-bold text-slate-400 uppercase">Descrição Opcional</label><input className={inpCls} value={formData.description} onChange={e=>setFormData({...formData,description:e.target.value})} /></div>
          <div className="flex gap-2"><button type="button" onClick={closeMod} className="flex-1 py-2 border rounded">Cancelar</button><button type="submit" className="flex-1 py-2 bg-indigo-600 text-white rounded">Salvar</button></div>
        </form></div></div>
      )}

      {showDel && payToDel && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50"><div className="bg-white p-6 rounded-xl w-full max-w-sm text-center"><Trash2 size={30} className="mx-auto text-red-500 mb-4"/><h3 className="text-lg font-black mb-4">Excluir Pagamento</h3><div className="space-y-2"><button onClick={()=>del('single')} className="w-full py-2 bg-red-600 text-white rounded font-bold">Excluir Parcela</button>{(payToDel.installmentId || (payToDel as any).asaasIdParaExcluir) && <button onClick={()=>del('all')} className="w-full py-2 border border-red-200 text-red-600 rounded font-bold">Excluir Carnê Completo</button>}<button onClick={closeMod} className="w-full py-2 text-slate-500">Cancelar</button></div></div></div>
      )}

      {showFallback && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50"><div className="bg-white p-6 rounded-xl w-full max-w-2xl"><h3 className="text-xl font-black mb-4">Carnê Digital</h3><div className="grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">{fallbackInst.map(p=><div key={p.id} className="border p-4 rounded"><div className="text-xs text-indigo-500 font-bold">Parc. {p.numero}</div><div className="text-lg font-black">R$ {p.valor}</div><div className="text-sm">{new Date(p.vencimento).toLocaleDateString('pt-BR')}</div><div className="mt-2 pt-2 border-t flex justify-end">{p.asaasPaymentId ? <button onClick={()=>handleLink(p.asaasPaymentId,'boleto')} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded font-bold flex gap-1"><Barcode size={12}/> Boleto</button> : <span className="text-xs text-slate-400">Indisponível</span>}</div></div>)}</div><button onClick={()=>setShowFallback(false)} className="mt-4 w-full py-2 border rounded font-bold">Fechar</button></div></div>
      )}

      {showPrint && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50"><div className="bg-white p-6 rounded-xl w-full max-w-md"><h3 className="text-xl font-black mb-4">Imprimir Carnê</h3><SearchableSelect label="Selecione o Aluno" options={data.students.map(s=>({id:s.id,name:s.name}))} value={selCarne} onChange={setSelCarne} required/><div className="flex gap-2 mt-4"><button onClick={()=>setShowPrint(false)} className="flex-1 py-2 border rounded font-bold">Cancelar</button><button onClick={()=>{handlePrint(selCarne); setShowPrint(false); setSelCarne('');}} className="flex-1 py-2 bg-indigo-600 text-white rounded font-bold">Imprimir</button></div></div></div>
      )}
    </div>
  );
};

export default Finance;
