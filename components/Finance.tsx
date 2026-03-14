import React, { useState, useMemo } from 'react';
import { SchoolData, Payment, Student } from '../types';
import { useDialog } from '../DialogContext';
import SearchableSelect from './SearchableSelect';
import { CheckCircle, Clock, AlertCircle, RefreshCw, Filter, DollarSign, Plus, X, Download, FileSignature, Printer, Tag, Hash, User, BookOpen, Trash2, Eye, Calendar, AlertTriangle, Barcode, Receipt, Layers, ChevronUp, ChevronDown } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { supabase, isSupabaseConfigured } from '../services/supabase';

interface FinanceProps {
  data: SchoolData;
  updateData: (newData: Partial<SchoolData>) => void;
}

const Finance: React.FC<FinanceProps> = ({ data, updateData }) => {
  const { showAlert } = useDialog();
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'overdue'>('all');
  const [filterType, setFilterType] = useState<'all' | 'avulsas' | 'parcelamentos'>('all');
  const [expandedInstallments, setExpandedInstallments] = useState<string[]>([]);
  const [filterStudent, setFilterStudent] = useState<string>('all');
  const [filterClass, setFilterClass] = useState<string>('all');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPrintCarneModal, setShowPrintCarneModal] = useState(false);
  
  const [selectedStudentHistory, setSelectedStudentHistory] = useState<Student | null>(null);
  const [selectedStudentForCarne, setSelectedStudentForCarne] = useState<string>('');
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetchingCarne, setIsFetchingCarne] = useState(false);

  React.useEffect(() => {
    syncAsaasPayments();
  }, []);

  const [showFallbackModal, setShowFallbackModal] = useState(false);
  const [fallbackInstallments, setFallbackInstallments] = useState<any[]>([]);

  const handleOpenPaymentLink = async (id: string, type: 'boleto' | 'recibo' | 'carne') => {
    try {
      showAlert('Aguarde', `Buscando ${type}...`, 'info');
      if (type === 'carne') {
        const response = await fetch(`/api/parcelamentos/${id}/carne`);
        const result = await response.json();
        if (response.ok) {
          if (result.type === 'fallback') {
            setFallbackInstallments(result.boletos);
            setShowFallbackModal(true);
            showAlert('Atenção', result.message, 'info');
          } else if (result.type === 'pdf' && result.url) {
            window.open(result.url, '_blank', 'noopener,noreferrer');
            showAlert('Sucesso', 'Carnê localizado!', 'success');
          }
        } else {
          showAlert('Erro', result.error || 'Falha ao buscar carnê.', 'error');
        }
        return;
      }
      const response = await fetch(`/api/cobrancas/${id}/link`);
      const result = await response.json();
      if (response.ok) {
        const url = type === 'boleto' ? result.bankSlipUrl : result.transactionReceiptUrl;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        else showAlert('Atenção', `Link não disponível.`, 'warning');
      }
    } catch (error) {
      showAlert('Erro', 'Ocorreu um erro na solicitação.', 'error');
    }
  };

  const handlePrintCarne = async (studentId: string) => {
    setIsFetchingCarne(true);
    try {
      const response = await fetch(`/api/alunos/${studentId}/carne`);
      const result = await response.json();
      if (response.ok) {
        if (result.type === 'fallback') {
          setFallbackInstallments(result.boletos);
          setShowFallbackModal(true);
        } else if (result.type === 'pdf' && result.url) {
          window.open(result.url, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsFetchingCarne(false);
    }
  };

  const dataPaymentsRef = React.useRef(data.payments);
  React.useEffect(() => { dataPaymentsRef.current = data.payments; }, [data.payments]);

  const syncAsaasPayments = async () => {
    if (!isSupabaseConfigured() || isSyncing) return;
    setIsSyncing(true);
    try {
      const { data: cloudPayments, error } = await supabase
        .from('alunos_cobrancas')
        .select('asaas_payment_id, status, aluno_id, valor, vencimento, data_pagamento, installment, link_boleto');
      if (error) throw error;
      if (cloudPayments && cloudPayments.length > 0) {
        const updatedPayments = dataPaymentsRef.current.map(p => {
          const match = cloudPayments.find(cp => p.asaasPaymentId ? cp.asaas_payment_id === p.asaasPaymentId : (cp.aluno_id === p.studentId && Math.abs(cp.valor - p.amount) < 0.01 && cp.vencimento === p.dueDate));
          if (match) {
            const s = (match.status || '').toLowerCase();
            const newStatus = s === 'pago' ? 'paid' : s === 'atrasado' ? 'overdue' : 'pending';
            return { ...p, status: newStatus as any, installmentId: match.installment || p.installmentId, asaasPaymentId: match.asaas_payment_id || p.asaasPaymentId };
          }
          return p;
        });
        updateData({ payments: updatedPayments });
      }
    } catch (e) { console.error(e); } finally { setIsSyncing(false); }
  };

  const filteredPayments = data.payments
    .filter(p => {
      const statusMatch = filterStatus === 'all' || p.status === filterStatus;
      const studentMatch = filterStudent === 'all' || p.studentId === filterStudent;
      const typeMatch = filterType === 'all' || (filterType === 'avulsas' ? !p.installmentId : !!p.installmentId);
      return statusMatch && studentMatch && typeMatch;
    })
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const groupedInstallments = useMemo(() => {
    if (filterType !== 'parcelamentos') return [];
    const groups: Record<string, Payment[]> = {};
    filteredPayments.forEach(p => { if (p.installmentId) { if (!groups[p.installmentId]) groups[p.installmentId] = []; groups[p.installmentId].push(p); } });
    return Object.entries(groups).map(([id, payments]) => ({
      installmentId: id, payments: payments.sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0)),
      studentId: payments[0].studentId, totalAmount: payments.reduce((sum, p) => sum + p.amount, 0), description: payments[0].description?.split(' (')[0] || 'Parcelamento', dueDate: payments[0].dueDate
    }));
  }, [filteredPayments, filterType]);

  const toggleInstallment = (id: string) => setExpandedInstallments(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleDelete = async (deleteType: 'single' | 'all') => {
    if (!paymentToDelete) return;
    let asaasIdToDelete = deleteType === 'all' ? (paymentToDelete.installmentId || (paymentToDelete as any).asaasIdParaExcluir) : paymentToDelete.asaasPaymentId;

    if (asaasIdToDelete && !asaasIdToDelete.startsWith('inst_') && !asaasIdToDelete.startsWith('pay_')) {
      let updated = data.payments.filter(p => deleteType === 'all' ? p.installmentId !== asaasIdToDelete : p.id !== paymentToDelete.id);
      updateData({ payments: updated });
      closeModal();
      return;
    }

    try {
      showAlert('Aguarde', 'Excluindo no Asaas...', 'info');
      const response = await fetch('/api/excluir_cobranca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: asaasIdToDelete })
      });
      if (response.ok) {
        let updated = data.payments.filter(p => asaasIdToDelete?.startsWith('inst_') ? p.installmentId !== asaasIdToDelete : p.asaasPaymentId !== asaasIdToDelete);
        updateData({ payments: updated });
        showAlert('Sucesso', 'Excluído!', 'success');
      }
    } catch (e) { console.error(e); }
    closeModal();
  };

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsModalOpen(false); setShowHistoryModal(false); setShowDeleteModal(false); setIsClosing(false); setPaymentToDelete(null);
    }, 300);
  };

  const getStatusBadge = (p: Payment) => {
    const s = p.status;
    if (s === 'paid') return <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase"><CheckCircle size={12}/> Pago</span>;
    if (s === 'overdue') return <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase"><AlertCircle size={12}/> Atrasado</span>;
    return <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase"><Clock size={12}/> Pendente</span>;
  };

  const inputClass = "px-4 py-2 bg-white text-black border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs";

  return (
    <div className="space-y-6 p-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Financeiro</h2>
          <p className="text-slate-500 text-sm">Gestão de mensalidades e contratos.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPrintCarneModal(true)} className="bg-white text-indigo-600 border border-indigo-200 px-4 py-2 rounded-xl flex items-center gap-2 font-bold"><Printer size={20} /> Carnê</button>
          <button onClick={() => setIsModalOpen(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-lg"><Plus size={20} /> Novo</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-4 border-b bg-slate-50/30 flex flex-wrap gap-4">
          <select className="border p-2 rounded-lg text-xs" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
            <option value="all">Todas as Cobranças</option>
            <option value="avulsas">Avulsas</option>
            <option value="parcelamentos">Carnês</option>
          </select>
          <select className="border p-2 rounded-lg text-xs" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
            <option value="all">Todos os Status</option>
            <option value="pending">Pendentes</option>
            <option value="paid">Pagos</option>
            <option value="overdue">Atrasados</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black tracking-wider">
              <tr>
                <th className="px-6 py-4">Aluno / Descrição</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4">Valor</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filterType === 'parcelamentos' ? groupedInstallments.map(group => (
                <tr key={group.installmentId} className="bg-slate-50/50">
                  <td className="px-6 py-5">
                    <div className="font-bold text-slate-900">{data.students.find(s => s.id === group.studentId)?.name}</div>
                    <div className="text-[10px] text-indigo-500 font-black uppercase flex items-center gap-1 mt-1"><Layers size={12}/> Carnê {group.payments.length}x</div>
                  </td>
                  <td className="px-6 py-5 text-slate-400 text-xs italic">Vários</td>
                  <td className="px-6 py-5 font-black text-slate-900">R$ {group.totalAmount.toFixed(2)}</td>
                  <td className="px-6 py-5"><span className="bg-indigo-50 text-indigo-600 text-[10px] px-2 py-0.5 rounded-lg font-bold">PARCELADO</span></td>
                  <td className="px-6 py-5 text-right flex justify-end gap-2">
                    <button onClick={() => toggleInstallment(group.installmentId)} className="text-xs font-bold border px-2 py-1 rounded-lg">Ver</button>
                    <button onClick={() => handleOpenPaymentLink(group.installmentId, 'carne')} className="text-indigo-600"><Printer size={18}/></button>
                    <button onClick={() => { setPaymentToDelete({ ...group.payments[0], installmentId: group.installmentId, asaasIdParaExcluir: group.installmentId } as any); setShowDeleteModal(true); }} className="text-red-400"><Trash2 size={18}/></button>
                  </td>
                </tr>
              )) : filteredPayments.map(p => (
                <tr key={p.id}>
                  <td className="px-6 py-5">
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      {data.students.find(s => s.id === p.studentId)?.name}
                      <Eye size={14} className="text-slate-300 cursor-pointer" onClick={() => { setSelectedStudentHistory(data.students.find(s => s.id === p.studentId) || null); setShowHistoryModal(true); }}/>
                    </div>
                    <div className="text-[10px] text-slate-400">{p.description}</div>
                  </td>
                  <td className="px-6 py-5 text-sm">{new Date(p.dueDate).toLocaleDateString('pt-BR')}</td>
                  <td className="px-6 py-5 font-black text-slate-900">R$ {p.amount.toFixed(2)}</td>
                  <td className="px-6 py-5">{getStatusBadge(p)}</td>
                  <td className="px-6 py-5 text-right flex justify-end gap-2">
                    {p.asaasPaymentId && <button onClick={() => handleOpenPaymentLink(p.asaasPaymentId!, 'boleto')}><Barcode size={18}/></button>}
                    <button onClick={() => { setPaymentToDelete(p); setShowDeleteModal(true); }} className="text-red-400"><Trash2 size={18}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showDeleteModal && paymentToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 text-center shadow-2xl relative overflow-hidden">
            <div className="bg-indigo-600 h-1.5 w-full absolute top-0 left-0"></div>
            <Trash2 size={48} className="mx-auto text-red-500 mb-4"/>
            <h3 className="text-lg font-black mb-2">Excluir Pagamento</h3>
            <p className="text-sm text-slate-500 mb-6">Esta ação removerá o registro do sistema e do Asaas.</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => handleDelete('single')} className="bg-red-600 text-white py-3 rounded-xl font-bold">Excluir Apenas Esta Parcela</button>
              {(paymentToDelete.installmentId || (paymentToDelete as any).asaasIdParaExcluir) && (
                <button onClick={() => handleDelete('all')} className="border-2 border-red-100 text-red-600 py-3 rounded-xl font-bold">Excluir Carnê Completo</button>
              )}
              <button onClick={closeModal} className="text-slate-400 py-2 font-bold">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Finance;