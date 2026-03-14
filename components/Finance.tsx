import React, { useState, useMemo } from 'react';
import { SchoolData, Payment, Student } from '../types';
import { useDialog } from '../DialogContext';
import SearchableSelect from './SearchableSelect';
import { CheckCircle, Clock, AlertCircle, RefreshCw, Filter, Plus, X, Printer, Tag, Hash, User, BookOpen, Trash2, Eye, Barcode, Receipt, Layers, ChevronUp, ChevronDown } from 'lucide-react';
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
  const [showFallbackModal, setShowFallbackModal] = useState(false);
  const [fallbackInstallments, setFallbackInstallments] = useState<any[]>([]);

  React.useEffect(() => {
    syncAsaasPayments();
  }, []);

  const dataPaymentsRef = React.useRef(data.payments);
  React.useEffect(() => {
    dataPaymentsRef.current = data.payments;
  }, [data.payments]);

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
          } else if (result.type === 'pdf' && result.url) {
            window.open(result.url, '_blank');
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
        if (url) window.open(url, '_blank');
        else showAlert('Atenção', 'Link não disponível.', 'warning');
      }
    } catch (error) {
      showAlert('Erro', 'Erro ao processar solicitação.', 'error');
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
          window.open(result.url, '_blank');
        }
      }
    } finally {
      setIsFetchingCarne(false);
    }
  };

  const syncAsaasPayments = async () => {
    if (!isSupabaseConfigured() || isSyncing) return;
    setIsSyncing(true);
    try {
      const { data: cloudPayments, error } = await supabase
        .from('alunos_cobrancas')
        .select('asaas_payment_id, status, valor, vencimento, data_pagamento, installment, link_boleto');
      if (error) throw error;
      if (cloudPayments) {
        const updatedPayments = dataPaymentsRef.current.map(p => {
          const match = cloudPayments.find(cp => cp.asaas_payment_id === p.asaasPaymentId);
          if (match) {
            const statusStr = (match.status || '').toLowerCase();
            const newStatus = statusStr === 'pago' ? 'paid' : statusStr === 'atrasado' ? 'overdue' : 'pending';
            return { ...p, status: newStatus as any, installmentId: match.installment || p.installmentId };
          }
          return p;
        });
        updateData({ payments: updatedPayments });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const [manualInstallments, setManualInstallments] = useState(1);
  const [dueDateDisplay, setDueDateDisplay] = useState(new Date().toLocaleDateString('pt-BR'));
  const [formData, setFormData] = useState({
    studentId: '', amount: 150, discount: 0, fine: 0, interest: 0,
    dueDate: new Date().toISOString().split('T')[0], type: 'monthly' as const, description: ''
  });

  const filteredPayments = data.payments.filter(p => {
    const statusMatch = filterStatus === 'all' || p.status === filterStatus;
    const studentMatch = filterStudent === 'all' || p.studentId === filterStudent;
    return statusMatch && studentMatch;
  }).sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const groupedInstallments = useMemo(() => {
    const groups: Record<string, Payment[]> = {};
    filteredPayments.forEach(p => {
      if (p.installmentId) {
        if (!groups[p.installmentId]) groups[p.installmentId] = [];
        groups[p.installmentId].push(p);
      }
    });
    return Object.entries(groups).map(([id, payments]) => ({
      installmentId: id,
      payments: payments.sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0)),
      studentId: payments[0].studentId,
      totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
    }));
  }, [filteredPayments]);

  const handleDelete = async (deleteType: 'single' | 'all') => {
    if (!paymentToDelete) return;
    let asaasIdToDelete = deleteType === 'all' ? (paymentToDelete.installmentId || (paymentToDelete as any).asaasIdParaExcluir) : paymentToDelete.asaasPaymentId;
    
    if (asaasIdToDelete && !asaasIdToDelete.startsWith('inst_') && !asaasIdToDelete.startsWith('pay_')) {
      const updated = data.payments.filter(p => deleteType === 'all' ? p.installmentId !== asaasIdToDelete : p.id !== paymentToDelete.id);
      updateData({ payments: updated });
      closeModal();
      return;
    }

    try {
      const response = await fetch('/api/excluir_cobranca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: asaasIdToDelete })
      });
      if (response.ok) {
        const updated = data.payments.filter(p => asaasIdToDelete?.startsWith('inst_') ? p.installmentId !== asaasIdToDelete : p.asaasPaymentId !== asaasIdToDelete);
        updateData({ payments: updated });
        showAlert('Sucesso', 'Excluído!', 'success');
      }
    } finally {
      closeModal();
    }
  };

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsModalOpen(false); setShowHistoryModal(false); setShowDeleteModal(false); setIsClosing(false);
    }, 300);
  };

  const getStatusBadge = (p: Payment) => {
    const s = p.status;
    if (s === 'paid') return <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-bold">PAGO</span>;
    if (s === 'overdue') return <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded text-[10px] font-bold">ATRASADO</span>;
    return <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-bold">PENDENTE</span>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Financeiro</h2>
        <div className="flex gap-2">
           <button onClick={() => setShowPrintCarneModal(true)} className="bg-white border p-2 rounded-lg flex items-center gap-2"><Printer size={18}/> Carnê</button>
           <button onClick={() => setIsModalOpen(true)} className="bg-indigo-600 text-white p-2 rounded-lg flex items-center gap-2"><Plus size={18}/> Novo</button>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold">
            <tr>
              <th className="p-4">Aluno</th>
              <th className="p-4">Vencimento</th>
              <th className="p-4">Valor</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredPayments.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="p-4 font-medium">{data.students.find(s => s.id === p.studentId)?.name}</td>
                <td className="p-4">{new Date(p.dueDate).toLocaleDateString('pt-BR')}</td>
                <td className="p-4">R$ {p.amount.toFixed(2)}</td>
                <td className="p-4">{getStatusBadge(p)}</td>
                <td className="p-4 text-right flex justify-end gap-2">
                  {p.asaasPaymentId && (
                    <button onClick={() => handleOpenPaymentLink(p.asaasPaymentId!, 'boleto')} className="p-1 bg-gray-100 rounded"><Barcode size={16}/></button>
                  )}
                  <button onClick={() => { setPaymentToDelete(p); setShowDeleteModal(true); }} className="p-1 text-red-500"><Trash2 size={16}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-xl max-w-sm w-full text-center">
            <Trash2 size={40} className="mx-auto text-red-500 mb-4"/>
            <h3 className="font-bold mb-4">Excluir Cobrança?</h3>
            <div className="space-y-2">
              <button onClick={() => handleDelete('single')} className="w-full bg-red-600 text-white p-2 rounded-lg">Excluir Esta</button>
              {(paymentToDelete?.installmentId) && (
                <button onClick={() => handleDelete('all')} className="w-full border border-red-600 text-red-600 p-2 rounded-lg">Excluir Carnê Inteiro</button>
              )}
              <button onClick={closeModal} className="w-full p-2 text-gray-500">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Finance;