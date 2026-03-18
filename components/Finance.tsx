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
            showAlert('Sucesso', 'Carnê localizado com sucesso!', 'success');
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
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          showAlert('Atenção', `${type === 'boleto' ? 'Boleto' : 'Recibo'} não disponível no momento.`, 'warning');
        }
      } else {
        showAlert('Erro', result.error || `Falha ao buscar ${type}.`, 'error');
      }
    } catch (error) {
      console.error(`Erro ao buscar ${type}:`, error);
      showAlert('Erro', 'Ocorreu um erro ao tentar processar a solicitação.', 'error');
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
          showAlert('Atenção', result.message, 'info');
        } else if (result.type === 'pdf' && result.url) {
          window.open(result.url, '_blank', 'noopener,noreferrer');
          showAlert('Sucesso', 'Carnê localizado com sucesso!', 'success');
        }
      } else {
        showAlert('Atenção', result.error || 'Não foi possível encontrar o carnê deste aluno.', response.status === 400 ? 'warning' : 'error');
      }
    } catch (error) {
      console.error('Erro ao buscar carnê:', error);
      showAlert('Erro', 'Ocorreu um erro ao processar sua solicitação.', 'error');
    } finally {
      setIsFetchingCarne(false);
    }
  };

  const dataPaymentsRef = React.useRef(data.payments);
  React.useEffect(() => {
    dataPaymentsRef.current = data.payments;
  }, [data.payments]);

  const syncAsaasPayments = async () => {
    if (!isSupabaseConfigured() || isSyncing) return;
    
    setIsSyncing(true);
    try {
      const { data: cloudPayments, error } = await supabase
        .from('alunos_cobrancas')
        .select('asaas_payment_id, status, aluno_id, valor, vencimento, data_pagamento, installment, asaas_installment_id, link_boleto');

      if (error) throw error;

      if (cloudPayments && cloudPayments.length > 0) {
        let updatedCount = 0;
        const currentPayments = dataPaymentsRef.current;
        const updatedPayments = currentPayments.map(p => {
          const match = cloudPayments.find(cp => {
            if (p.asaasPaymentId) return cp.asaas_payment_id === p.asaasPaymentId;
            return cp.aluno_id === p.studentId && Math.abs(cp.valor - p.amount) < 0.01 && cp.vencimento === p.dueDate;
          });
          
          if (match) {
            const statusStr = (match.status || '').toLowerCase();
            const newStatus = statusStr === 'pago' ? 'paid' : 
                             statusStr === 'atrasado' ? 'overdue' : 
                             statusStr === 'cancelado' ? 'cancelled' : 'pending';
            
            if (p.status !== newStatus || p.amount !== match.valor || p.installmentId !== (match.asaas_installment_id || match.installment) || p.asaasPaymentUrl !== match.link_boleto || p.asaasPaymentId !== match.asaas_payment_id) {
              updatedCount++;
              return { 
                ...p, 
                status: newStatus as any, 
                amount: match.valor,
                paidDate: match.data_pagamento || p.paidDate,
                installmentId: match.asaas_installment_id || match.installment || p.installmentId,
                asaasPaymentUrl: match.link_boleto || p.asaasPaymentUrl,
                asaasPaymentId: match.asaas_payment_id || p.asaasPaymentId
              };
            }
          }
          return p;
        });

        if (updatedCount > 0) {
          updateData({ payments: updatedPayments });
          showAlert('Sincronização', `${updatedCount} pagamento(s) atualizado(s).`, 'success');
        }
      }
    } catch (error) {
      console.error('Erro ao sincronizar pagamentos:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const [manualInstallments, setManualInstallments] = useState(1);
  const [dueDateDisplay, setDueDateDisplay] = useState(new Date().toLocaleDateString('pt-BR'));
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedItemType, setSelectedItemType] = useState<'course' | 'handout' | ''>('');
  
  const [formData, setFormData] = useState<Omit<Payment, 'id' | 'status' | 'paidDate' | 'lateFee'> & { fine: number }>({
    studentId: '',
    amount: 150,
    discount: 0,
    discountType: 'fixed',
    fine: 0,
    interest: 0,
    dueDate: new Date().toISOString().split('T')[0],
    type: 'monthly',
    description: ''
  });

  React.useEffect(() => {
    if (formData.studentId) {
      const student = data.students.find(s => s.id === formData.studentId);
      if (student) {
        let fine = 0;
        let interest = 0;

        if (selectedItemId) {
          if (selectedItemId.startsWith('course_')) {
            const course = data.courses.find(c => c.id === selectedItemId.replace('course_', ''));
            fine = course?.finePercentage || 0;
            interest = course?.interestPercentage || 0;
          } else if (selectedItemId.startsWith('handout_')) {
            const handout = data.handouts?.find(h => h.id === selectedItemId.replace('handout_', ''));
            fine = handout?.finePercentage || 0;
            interest = handout?.interestPercentage || 0;
          }
        } else {
          const studentClass = data.classes.find(c => c.id === student.classId);
          const course = data.courses.find(c => c.id === studentClass?.courseId);
          fine = course?.finePercentage || 0;
          interest = course?.interestPercentage || 0;
        }

        setFormData(prev => ({ ...prev, fine: fine, interest: interest }));
      }
    }
  }, [formData.studentId, selectedItemId, data.students, data.classes, data.courses, data.handouts]);

  const formatDateMask = (val: string) => {
    return val.replace(/\D/g, '').replace(/(\d{2})(\d)/, '$1/$2').replace(/(\d{2})(\d)/, '$1/$2').slice(0, 10);
  };

  const dateBrToIso = (br: string) => {
    if (br.length !== 10) return '';
    const [d, m, y] = br.split('/');
    return `${y}-${m}-${d}`;
  };

  const filteredPayments = data.payments
    .filter(p => {
      const statusMatch = filterStatus === 'all' || p.status === filterStatus;
      const studentMatch = filterStudent === 'all' || p.studentId === filterStudent;
      
      let classMatch = true;
      if (filterClass !== 'all') {
        const student = data.students.find(s => s.id === p.studentId);
        classMatch = student?.classId === filterClass;
      }

      let typeMatch = true;
      if (filterType === 'avulsas') typeMatch = !p.installmentId;
      else if (filterType === 'parcelamentos') typeMatch = !!p.installmentId;

      return statusMatch && studentMatch && classMatch && typeMatch;
    })
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const groupedInstallments = useMemo(() => {
    if (filterType !== 'parcelamentos') return [];
    
    const groups: Record<string, Payment[]> = {};
    filteredPayments.forEach(p => {
      if (p.installmentId) {
        if (!groups[p.installmentId]) groups[p.installmentId] = [];
        groups[p.installmentId].push(p);
      }
    });
    
    return Object.entries(groups).map(([id, payments]) => {
      const sorted = payments.sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0));
      return {
        installmentId: id,
        payments: sorted,
        studentId: sorted[0].studentId,
        totalAmount: sorted.reduce((sum, p) => sum + p.amount, 0),
        totalInstallments: sorted[0].totalInstallments || sorted.length,
        description: sorted[0].description?.split(' (')[0] || 'Parcelamento',
        dueDate: sorted[0].dueDate
      };
    }).sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
  }, [filteredPayments, filterType]);

  const toggleInstallment = (id: string) => {
    setExpandedInstallments(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleItemSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedItemId(val);
    
    if (!val) {
      setSelectedItemType('');
      setFormData(prev => ({...prev, amount: 0, description: ''}));
      return;
    }

    if (val === 'registration_fee') {
      setSelectedItemType('registration');
      setFormData(prev => ({ ...formData, amount: 150, description: 'Taxa de Matrícula', type: 'registration' }));
      return;
    }

    if (val.startsWith('course_')) {
      const courseId = val.replace('course_', '');
      const course = data.courses.find(c => c.id === courseId);
      if (course) {
        setSelectedItemType('course');
        setFormData(prev => ({ ...prev, amount: course.monthlyFee, description: `Mensalidade - ${course.name}`, type: 'monthly', fine: course.finePercentage || 0, interest: course.interestPercentage || 0 }));
      }
    } else if (val.startsWith('handout_')) {
      const handoutId = val.replace('handout_', '');
      const handout = data.handouts?.find(h => h.id === handoutId);
      if (handout) {
        setSelectedItemType('handout');
        setFormData(prev => ({ ...prev, amount: handout.price, description: `Apostila - ${handout.name}`, type: 'other', fine: handout.finePercentage || 0, interest: handout.interestPercentage || 0 }));
      }
    }
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.studentId || formData.amount <= 0) {
      showAlert('Atenção', '⚠️ Selecione um aluno e informe um valor válido.', 'warning');
      return;
    }

    const student = data.students.find(s => s.id === formData.studentId);
    if (!student) return;

    const newPayments: Payment[] = [];
    let baseDateStr = formData.dueDate;
    if (dueDateDisplay.length === 10) baseDateStr = dateBrToIso(dueDateDisplay);
    const baseDate = new Date(baseDateStr);

    for (let i = 0; i < manualInstallments; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(baseDate.getMonth() + i);

      const baseAmount = formData.amount;
      const { fine, ...rest } = formData;
      const paymentDueDate = dueDate.toISOString().split('T')[0];
      
      newPayments.push({
        ...rest,
        lateFee: fine,
        dueDate: paymentDueDate,
        id: crypto.randomUUID(),
        amount: baseAmount,
        status: 'pending',
        installmentNumber: manualInstallments > 1 ? i + 1 : undefined,
        totalInstallments: manualInstallments > 1 ? manualInstallments : undefined,
        description: manualInstallments > 1 ? `${formData.description || 'Mensalidade'} (${i + 1}/${manualInstallments})` : formData.description
      });
    }

    try {
      const rawCpf = (student.cpf || student.guardianCpf || '').replace(/\D/g, '');
      const isoDueDate = newPayments[0].dueDate;
      
      const response = await fetch('/api/gerar_cobranca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aluno_id: student.id,
          nome: student.name,
          cpf: rawCpf,
          email: student.email,
          valor: formData.amount,
          vencimento: isoDueDate,
          multa: formData.fine,
          juros: formData.interest,
          desconto: Number(formData.discount) || 0,
          telefone: student.phone,
          cep: student.addressZip,
          endereco: student.addressStreet,
          numero: student.addressNumber,
          bairro: student.addressNeighborhood,
          descricao: formData.description || 'Mensalidade',
          parcelas: manualInstallments
        })
      });

      if (response.ok) {
        const asaasData = await response.json();
        if (asaasData.payments && asaasData.payments.length > 0) {
          newPayments.forEach((p, idx) => {
            const asaasPayment = asaasData.payments[idx] || asaasData.payments[asaasData.payments.length - 1];
            p.asaasPaymentUrl = asaasPayment.link_boleto;
            p.asaasPaymentId = asaasPayment.asaas_payment_id;
            if (asaasData.installment) p.installmentId = asaasData.installment;
          });
        }
      }
    } catch (error) {
      console.error('Erro Asaas:', error);
      showAlert('Atenção', 'Erro Asaas. Salvo apenas localmente.', 'warning');
    }

    updateData({ payments: [...data.payments, ...newPayments] });
    showAlert('Sucesso', 'Cobrança gerada com sucesso.', 'success');
    closeModal();
  };

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsModalOpen(false);
      setShowHistoryModal(false);
      setShowDeleteModal(false);
      setIsClosing(false);
      
      setManualInstallments(1);
      const today = new Date();
      setDueDateDisplay(today.toLocaleDateString('pt-BR'));
      setFormData({
        studentId: '', amount: 150, discount: 0, discountType: 'fixed', fine: 0, interest: 0,
        dueDate: today.toISOString().split('T')[0], type: 'monthly', description: ''
      });
      setSelectedStudentHistory(null);
      setPaymentToDelete(null);
    }, 300);
  };

  const handleDelete = async (deleteType: 'single' | 'all') => {
    if (!paymentToDelete) return;

    // Inteligência: Prioriza o envio do ID correto baseado no escopo da deleção
    let idToDelete = '';
    if (deleteType === 'all') {
      idToDelete = paymentToDelete.installmentId || (paymentToDelete as any).asaasIdParaExcluir || paymentToDelete.id;
    } else {
      idToDelete = paymentToDelete.asaasPaymentId || paymentToDelete.id;
    }

    if (!idToDelete) {
      showAlert('Erro', 'ID da cobrança não pôde ser identificado.', 'error');
      return;
    }

    try {
      showAlert('Aguarde', 'Excluindo cobrança...', 'info');
      const response = await fetch('/api/excluir_cobranca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: idToDelete })
      });

      if (response.ok) {
        showAlert('Sucesso', 'Cobrança excluída da base local e Asaas.', 'success');
        
        const updatedPayments = data.payments.filter(p => 
          p.id !== idToDelete && p.installmentId !== idToDelete && p.asaasPaymentId !== idToDelete
        );
        updateData({ payments: updatedPayments });
      } else {
        const result = await response.json();
        showAlert('Atenção', result.error || 'Erro na exclusão.', 'warning');
      }
    } catch (error) {
      console.error('Erro exclusao:', error);
      showAlert('Erro', 'Falha na comunicação com servidor.', 'error');
    }

    closeModal();
  };

  const openHistory = (studentId: string) => {
    const student = data.students.find(s => s.id === studentId);
    if (student) {
      setSelectedStudentHistory(student);
      setShowHistoryModal(true);
    }
  };

  const openDelete = (payment: Payment) => {
    setPaymentToDelete(payment);
    setShowDeleteModal(true);
  };

  const getStatusBadge = (payment: Payment) => {
    const status = (payment.status || '').toLowerCase();
    
    if (status === 'paid' || status === 'pago' || status === 'received' || status === 'confirmed') {
      const dueDate = new Date(payment.dueDate);
      const paidDate = payment.paidDate ? new Date(payment.paidDate) : null;
      
      if (paidDate && paidDate > dueDate) {
        return <span className="inline-flex items-center gap-1 text-emerald-900 bg-emerald-100 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"><CheckCircle size={12}/> Pago Atrasado</span>;
      }
      return <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"><CheckCircle size={12}/> Pago</span>;
    }
    if (status === 'overdue' || status === 'atrasado') {
      return <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"><AlertCircle size={12}/> Atrasado</span>;
    }
    return <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"><Clock size={12}/> Pendente</span>;
  };

  const inputClass = "px-4 py-2 bg-white text-black border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm text-xs";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Financeiro</h2>
          <p className="text-slate-500 text-sm">Gestão de mensalidades vinculadas a contratos e cursos.</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button 
            onClick={() => setShowPrintCarneModal(true)}
            className="flex-1 sm:flex-none bg-white text-indigo-600 border border-indigo-200 px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-50 transition-all shadow-sm font-bold active:scale-95"
          >
            <Printer size={20} /> Imprimir Carnê
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex-1 sm:flex-none bg-indigo-600 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg font-bold active:scale-95"
          >
            <Plus size={20} /> Novo Lançamento
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/30 space-y-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                <Filter size={16} className="text-slate-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Visão:</span>
              </div>
              <div className="flex gap-1.5">
                {(['all', 'avulsas', 'parcelamentos'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${
                      filterType === type ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    {type === 'all' ? 'Todas Cobranças' : type === 'avulsas' ? 'Avulsas' : 'Carnês'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                <Filter size={16} className="text-slate-400" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Status:</span>
              </div>
              <div className="flex gap-1.5">
                {(['all', 'pending', 'paid', 'overdue'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${
                      filterStatus === status ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    {status === 'all' ? 'Todos' : status === 'paid' ? 'Pagos' : status === 'pending' ? 'Pendentes' : 'Atrasados'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <BookOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select className={`${inputClass} w-full pl-9`} value={filterClass} onChange={e => { setFilterClass(e.target.value); setFilterStudent('all'); }}>
                <option value="all">Todas as Turmas</option>
                {data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select className={`${inputClass} w-full pl-9`} value={filterStudent} onChange={e => setFilterStudent(e.target.value)}>
                <option value="all">Todos os Alunos</option>
                {data.students.filter(s => filterClass === 'all' || s.classId === filterClass).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black tracking-[0.1em]">
              <tr>
                <th className="px-6 py-4">Aluno / Descrição</th>
                <th className="px-6 py-4">Vencimento</th>
                <th className="px-6 py-4">Valor</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filterType === 'parcelamentos' ? (
                groupedInstallments.map(group => {
                  const student = data.students.find(s => s.id === group.studentId);
                  const isExpanded = expandedInstallments.includes(group.installmentId);
                  
                  return (
                    <React.Fragment key={group.installmentId}>
                      <tr className="hover:bg-indigo-50/30 transition-colors group bg-slate-50/50">
                        <td className="px-6 py-5">
                          <div className="font-bold text-slate-900">{student?.name || 'Aluno Removido'}</div>
                          <div className="text-[10px] font-black text-indigo-500 uppercase tracking-wide mt-1">Carnê de {group.payments.length}x</div>
                        </td>
                        <td className="px-6 py-5 text-slate-600 text-sm font-medium">
                          {group.payments.length > 0 && <span>Fim: {new Date(group.payments[group.payments.length - 1].dueDate).toLocaleDateString('pt-BR')}</span>}
                        </td>
                        <td className="px-6 py-5">
                          <div className="font-black text-slate-900">R$ {group.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                        </td>
                        <td className="px-6 py-5">
                          <span className="inline-flex items-center gap-1 text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider">
                            <Layers size={12}/> {group.payments.length} Parcelas
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right flex justify-end gap-2">
                          <button onClick={() => toggleInstallment(group.installmentId)} className="px-3 py-1.5 bg-white text-slate-700 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50 inline-flex items-center gap-1.5">
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {isExpanded ? 'Ocultar' : 'Ver'}
                          </button>
                          <button onClick={() => handleOpenPaymentLink(group.installmentId, 'carne')} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 border border-indigo-100 inline-flex items-center gap-1.5">
                            <Printer size={14} /> Imprimir Carnê
                          </button>
                          <button onClick={() => openDelete({ ...group.payments[0], id: group.installmentId, installmentId: group.installmentId, asaasIdParaExcluir: group.installmentId } as any)} className="p-2 text-slate-400 hover:text-red-600 transition-all"><Trash2 size={18} /></button>
                        </td>
                      </tr>
                      {isExpanded && group.payments.map(payment => (
                        <tr key={payment.id} className="hover:bg-indigo-50/10 transition-colors bg-white">
                          <td className="px-6 py-4 pl-12 text-[10px] font-black text-slate-500 uppercase">
                            Parcela {payment.installmentNumber}/{payment.totalInstallments}
                          </td>
                          <td className="px-6 py-4 text-slate-600 text-sm font-medium">{new Date(payment.dueDate).toLocaleDateString('pt-BR')}</td>
                          <td className="px-6 py-4 font-bold text-slate-700">R$ {payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-6 py-4">{getStatusBadge(payment)}</td>
                          <td className="px-6 py-4 text-right flex justify-end gap-2">
                            {payment.asaasPaymentId && (
                              <>
                                {(payment.status === 'pending' || payment.status === 'overdue') && (
                                  <button onClick={() => handleOpenPaymentLink(payment.asaasPaymentId!, 'boleto')} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold hover:bg-slate-200 inline-flex items-center gap-1.5">
                                    <Barcode size={12} /> Boleto
                                  </button>
                                )}
                                {(payment.status === 'paid' || payment.status === 'received' || payment.status === 'confirmed') && (
                                  <button onClick={() => handleOpenPaymentLink(payment.asaasPaymentId!, 'recibo')} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-bold hover:bg-emerald-100 border border-emerald-100 inline-flex items-center gap-1.5">
                                    <Receipt size={12} /> Recibo
                                  </button>
                                )}
                              </>
                            )}
                            <button onClick={() => openDelete(payment)} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })
              ) : (
                filteredPayments.map(payment => {
                  const student = data.students.find(s => s.id === payment.studentId);
                  return (
                    <tr key={payment.id} className="hover:bg-indigo-50/30 transition-colors group">
                      <td className="px-6 py-5">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          {student?.name || 'Aluno Removido'}
                          <button onClick={() => student && openHistory(student.id)} className="text-slate-400 hover:text-indigo-600"><Eye size={14} /></button>
                        </div>
                        <div className="text-[10px] font-black text-indigo-500 uppercase tracking-wide">
                          {payment.type === 'registration' ? 'Matrícula' : 'Mensalidade'} 
                          {payment.installmentNumber && <span> {payment.installmentNumber}/{payment.totalInstallments}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-slate-600 text-sm font-medium">{new Date(payment.dueDate).toLocaleDateString('pt-BR')}</td>
                      <td className="px-6 py-5 font-black text-slate-900">R$ {payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="px-6 py-5">{getStatusBadge(payment)}</td>
                      <td className="px-6 py-5 text-right flex justify-end gap-2">
                        {payment.asaasPaymentId && (
                          <>
                            {(payment.status === 'pending' || payment.status === 'overdue') && (
                              <button onClick={() => handleOpenPaymentLink(payment.asaasPaymentId!, 'boleto')} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 inline-flex items-center gap-1.5">
                                <Barcode size={14} /> Boleto
                              </button>
                            )}
                            {(payment.status === 'paid' || payment.status === 'received' || payment.status === 'confirmed') && (
                              <button onClick={() => handleOpenPaymentLink(payment.asaasPaymentId!, 'recibo')} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 border border-emerald-100 inline-flex items-center gap-1.5">
                                <Receipt size={14} /> Recibo
                              </button>
                            )}
                          </>
                        )}
                        <button onClick={() => openDelete(payment)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={18} /></button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEW PAYMENT MODAL */}
      {isModalOpen && (
        <div className={`fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 overflow-y-auto ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl relative overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between bg-indigo-50/30">
              <h3 className="text-xl font-black text-slate-800">Novo Lançamento</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-red-500"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreatePayment} className="p-6 space-y-4">
              <SearchableSelect
                label="Aluno Beneficiário"
                placeholder="Selecione o aluno..."
                required
                options={data.students.map(s => ({ id: s.id, name: s.name }))}
                value={formData.studentId}
                onChange={val => setFormData({...formData, studentId: val})}
              />
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Referente a</label>
                <select className={inputClass + " w-full"} value={selectedItemId} onChange={handleItemSelect}>
                  <option value="">Avulso / Personalizado</option>
                  <option value="registration_fee">Matrícula</option>
                  <optgroup label="Cursos">{data.courses?.map(c => <option key={c.id} value={`course_${c.id}`}>{c.name}</option>)}</optgroup>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Tipo</label>
                  <select className={inputClass + " w-full"} value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})}>
                    <option value="monthly">Mensalidade</option>
                    <option value="registration">Matrícula</option>
                    <option value="other">Outros</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Qtd. Parcelas</label>
                  <input type="number" min="1" max="100" className={inputClass + " w-full"} value={manualInstallments} onChange={e => setManualInstallments(parseInt(e.target.value) || 1)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Valor Base (R$)</label>
                  <input type="number" step="0.01" className={inputClass + " w-full"} value={formData.amount} onChange={e => setFormData({...formData, amount: parseFloat(e.target.value)})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Vencimento</label>
                  <input className={inputClass + " w-full"} value={dueDateDisplay} onChange={e => {
                    const masked = formatDateMask(e.target.value);
                    setDueDateDisplay(masked);
                    if (masked.length === 10) setFormData(prev => ({...prev, dueDate: dateBrToIso(masked)}));
                  }} maxLength={10} />
                </div>
              </div>
              <div className="pt-4 flex gap-4">
                <button type="button" onClick={closeModal} className="flex-1 py-3 border border-slate-200 rounded-xl text-slate-600 font-bold text-xs">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs">Gerar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && paymentToDelete && (
        <div className={`fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 overflow-y-auto ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl relative overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 size={24} /></div>
              <h3 className="text-lg font-black text-slate-800 mb-2">Excluir Pagamento</h3>
              
              <div className="flex flex-col gap-2 mt-6">
                {paymentToDelete.id && typeof paymentToDelete.id === 'string' && paymentToDelete.id.startsWith('inst_') ? (
                  <button onClick={() => handleDelete('all')} className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm">Excluir Carnê Completo</button>
                ) : (
                  <>
                    <button onClick={() => handleDelete('single')} className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm">Excluir Apenas Esta Parcela</button>
                    {(paymentToDelete.installmentId || paymentToDelete.totalInstallments) && (
                      <button onClick={() => handleDelete('all')} className="w-full py-3 border-2 border-red-100 text-red-600 rounded-xl font-bold text-sm">Excluir Carnê Completo (Asaas)</button>
                    )}
                  </>
                )}
                <button onClick={closeModal} className="w-full py-3 text-slate-400 font-bold text-sm">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FALLBACK CARNE MODAL (Boletos individuais puxando código de barras do Asaas) */}
      {showFallbackModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl relative overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
              <div>
                <h3 className="text-2xl font-black text-slate-800">Carnê Digital</h3>
                <p className="text-sm text-slate-500">O PDF unificado não está disponível. Acesse os boletos individuais.</p>
              </div>
              <button onClick={() => setShowFallbackModal(false)} className="text-slate-400 hover:text-red-500"><X size={24} /></button>
            </div>
            
            <div className="p-8 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {fallbackInstallments.map((parcela) => (
                  <div key={parcela.id} className="border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between">
                      <div>
                        <div className="text-xs font-black text-indigo-500 uppercase">Parcela {parcela.numero}</div>
                        <div className="text-lg font-bold text-slate-800">R$ {parcela.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-400">Vencimento</div>
                        <div className="text-sm font-bold text-slate-700">{new Date(parcela.vencimento).toLocaleDateString('pt-BR')}</div>
                      </div>
                    </div>
                    
                    <div className="pt-3 mt-3 border-t border-slate-100 flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase text-emerald-600">Disponível</span>
                      {parcela.asaasPaymentId ? (
                        <button onClick={() => handleOpenPaymentLink(parcela.asaasPaymentId, 'boleto')} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold flex items-center gap-1">
                          <Barcode size={14} /> Abrir Boleto
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Boleto não gerado</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button onClick={() => setShowFallbackModal(false)} className="px-6 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT CARNE MODAL */}
      {showPrintCarneModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl relative overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
              <h3 className="text-2xl font-black text-slate-800">Imprimir Carnê</h3>
              <button onClick={() => setShowPrintCarneModal(false)} className="text-slate-400 hover:text-red-500"><X size={24} /></button>
            </div>
            
            <div className="p-8 space-y-8">
              <SearchableSelect
                label="Aluno"
                placeholder="Selecione o aluno..."
                required
                options={data.students.map(s => ({ id: s.id, name: s.name }))}
                value={selectedStudentForCarne}
                onChange={setSelectedStudentForCarne}
              />
              <div className="flex justify-end gap-4 pt-4 border-t border-slate-100">
                <button onClick={() => setShowPrintCarneModal(false)} className="px-6 py-3 text-slate-600 font-bold rounded-xl">Cancelar</button>
                <button 
                  onClick={() => { handlePrintCarne(selectedStudentForCarne); setShowPrintCarneModal(false); setSelectedStudentForCarne(''); }}
                  disabled={!selectedStudentForCarne || isFetchingCarne}
                  className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl flex items-center gap-2"
                >
                  {isFetchingCarne ? <RefreshCw size={20} className="animate-spin" /> : <Printer size={20} />} Imprimir Carnê
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Finance;
