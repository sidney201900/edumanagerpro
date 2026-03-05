import React, { useState } from 'react';
import { SchoolData, Payment, Student } from '../types';
import { useDialog } from '../DialogContext';
import SearchableSelect from './SearchableSelect';
import { CheckCircle, Clock, AlertCircle, RefreshCw, Filter, DollarSign, Plus, X, Download, FileSignature, Printer, Tag, Hash, User, BookOpen, Trash2, Eye, Calendar, AlertTriangle } from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { supabase, isSupabaseConfigured } from '../services/supabase';

interface FinanceProps {
  data: SchoolData;
  updateData: (newData: Partial<SchoolData>) => void;
}

const Finance: React.FC<FinanceProps> = ({ data, updateData }) => {
  const { showAlert } = useDialog();
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid' | 'overdue'>('all');
  const [filterStudent, setFilterStudent] = useState<string>('all');
  const [filterClass, setFilterClass] = useState<string>('all');
  
  // Modais states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showExtraChargeModal, setShowExtraChargeModal] = useState(false); // Changed from Bulk
  
  // Selection states
  const [selectedStudentHistory, setSelectedStudentHistory] = useState<Student | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const syncAsaasPayments = async () => {
    if (!isSupabaseConfigured() || isSyncing) return;
    
    const pendingPayments = data.payments.filter(p => p.status === 'pending');
    if (pendingPayments.length === 0) return;

    setIsSyncing(true);
    try {
      const { data: cloudPayments, error } = await supabase
        .from('alunos_cobrancas')
        .select('asaas_payment_id, status, aluno_id, valor, vencimento')
        .eq('status', 'PAGO');

      if (error) throw error;

      if (cloudPayments && cloudPayments.length > 0) {
        let updatedCount = 0;
        const updatedPayments = data.payments.map(p => {
          if (p.status === 'pending') {
            // Match by asaasPaymentId if available, otherwise by student, amount and due date
            const match = cloudPayments.find(cp => {
              if (p.asaasPaymentId) {
                return cp.asaas_payment_id === p.asaasPaymentId;
              }
              return cp.aluno_id === p.studentId && 
                     Math.abs(cp.valor - p.amount) < 0.01 && 
                     cp.vencimento === p.dueDate;
            });
            
            if (match) {
              updatedCount++;
              return { ...p, status: 'paid' as const, paidDate: new Date().toISOString() };
            }
          }
          return p;
        });

        if (updatedCount > 0) {
          updateData({ payments: updatedPayments });
          showAlert('Sincronização', `${updatedCount} pagamento(s) confirmado(s) via Asaas!`, 'success');
        } else {
          showAlert('Sincronização', 'Nenhum novo pagamento confirmado encontrado.', 'info');
        }
      }
    } catch (error) {
      console.error('Erro ao sincronizar pagamentos:', error);
      showAlert('Erro', 'Falha ao sincronizar com o Asaas.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // General form state
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

  // Auto-fill fine and interest based on student's course or handout
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

        setFormData(prev => ({
          ...prev,
          fine: fine,
          interest: interest
        }));
      }
    }
  }, [formData.studentId, selectedItemId, data.students, data.classes, data.courses, data.handouts]);

  // Extra Charge Specific State
  const [extraChargeData, setExtraChargeData] = useState({
    studentId: '',
    amount: 0,
    installments: 1,
    description: 'Taxa Extra',
    firstDueDate: new Date().toLocaleDateString('pt-BR'),
    discount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage',
    fine: 0,
    interest: 0
  });

  // Auto-fill fine and interest for extra charge based on student's course
  React.useEffect(() => {
    if (extraChargeData.studentId) {
      const student = data.students.find(s => s.id === extraChargeData.studentId);
      if (student) {
        const studentClass = data.classes.find(c => c.id === student.classId);
        const course = data.courses.find(c => c.id === studentClass?.courseId);
        
        setExtraChargeData(prev => ({
          ...prev,
          fine: course?.finePercentage || 0,
          interest: course?.interestPercentage || 0
        }));
      }
    }
  }, [extraChargeData.studentId, data.students, data.classes, data.courses]);

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

      return statusMatch && studentMatch && classMatch;
    })
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const handleItemSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedItemId(val);
    
    if (!val) {
      setSelectedItemType('');
      setFormData(prev => ({...prev, amount: 0, description: ''}));
      return;
    }

    if (val.startsWith('course_')) {
      const courseId = val.replace('course_', '');
      const course = data.courses.find(c => c.id === courseId);
      if (course) {
        setSelectedItemType('course');
        setFormData(prev => ({
          ...prev, 
          amount: course.monthlyFee, 
          description: `Mensalidade - ${course.name}`,
          type: 'monthly',
          fine: course.finePercentage || 0,
          interest: course.interestPercentage || 0
        }));
      }
    } else if (val.startsWith('handout_')) {
      const handoutId = val.replace('handout_', '');
      const handout = data.handouts?.find(h => h.id === handoutId);
      if (handout) {
        setSelectedItemType('handout');
        setFormData(prev => ({
          ...prev, 
          amount: handout.price, 
          description: `Apostila - ${handout.name}`,
          type: 'other',
          fine: handout.finePercentage || 0,
          interest: handout.interestPercentage || 0
        }));
      }
    }
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.studentId || formData.amount <= 0) {
      showAlert('Atenção', '⚠️ Por favor, selecione um aluno e informe um valor válido.', 'warning');
      return;
    }

    const student = data.students.find(s => s.id === formData.studentId);
    if (!student) {
      showAlert('Erro', 'Aluno não encontrado.', 'error');
      return;
    }

    const newPayments: Payment[] = [];
    
    let baseDateStr = formData.dueDate;
    if (dueDateDisplay.length === 10) {
        baseDateStr = dateBrToIso(dueDateDisplay);
    }
    const baseDate = new Date(baseDateStr);

    for (let i = 0; i < manualInstallments; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(baseDate.getMonth() + i);

      // Enviar o valor integral para o Asaas, o desconto será condicional
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
        description: manualInstallments > 1 
          ? `${formData.description || 'Mensalidade'} (${i + 1}/${manualInstallments})`
          : formData.description
      });
    }

    try {
      const asaasRequests = newPayments.map(payment => {
        const rawCpf = (student.cpf || student.guardianCpf || '').replace(/\D/g, '');
        // Garantir que a data esteja em formato ISO YYYY-MM-DD (string pura)
        const isoDueDate = payment.dueDate;
        
        return fetch('/.netlify/functions/gerar_cobranca', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aluno_id: student.id,
            nome: student.name,
            cpf: rawCpf,
            email: student.email,
            valor: payment.amount,
            vencimento: isoDueDate,
            multa: payment.lateFee,
            juros: payment.interest,
            desconto: Number(payment.discount) || 0,
            telefone: student.phone,
            cep: student.addressZip,
            endereco: student.addressStreet,
            numero: student.addressNumber,
            bairro: student.addressNeighborhood,
            nascimento: student.birthDate,
            descricao: payment.description
          })
        });
      });

      const asaasResponses = await Promise.all(asaasRequests);
      const asaasData = await Promise.all(asaasResponses.map(async r => {
        if (r.ok) return r.json();
        return null;
      }));
      
      newPayments.forEach((p, idx) => {
        if (asaasData[idx]) {
          p.asaasPaymentUrl = asaasData[idx].bankSlipUrl;
          p.asaasPaymentId = asaasData[idx].paymentId;
        }
      });
    } catch (error) {
      console.error('Erro ao conectar com o Asaas:', error);
      showAlert('Atenção', 'Erro ao conectar com o Asaas. Lançamentos salvos apenas localmente.', 'warning');
    }

    let newDeliveries = [...(data.handoutDeliveries || [])];
    if (selectedItemType === 'handout' && newPayments.length > 0) {
      const handoutId = selectedItemId.replace('handout_', '');
      const firstPayment = newPayments[0];
      
      const existingDeliveryIndex = newDeliveries.findIndex(d => d.studentId === student.id && d.handoutId === handoutId);
      
      if (existingDeliveryIndex >= 0) {
        newDeliveries[existingDeliveryIndex] = {
          ...newDeliveries[existingDeliveryIndex],
          asaasPaymentId: firstPayment.asaasPaymentId,
          asaasPaymentUrl: firstPayment.asaasPaymentUrl
        };
      } else {
        newDeliveries.push({
          id: crypto.randomUUID(),
          studentId: student.id,
          handoutId: handoutId,
          deliveryStatus: 'pending',
          paymentStatus: 'pending',
          asaasPaymentId: firstPayment.asaasPaymentId,
          asaasPaymentUrl: firstPayment.asaasPaymentUrl
        });
      }
    }

    updateData({ 
      payments: [...data.payments, ...newPayments],
      ...(selectedItemType === 'handout' ? { handoutDeliveries: newDeliveries } : {})
    });
    closeModal();
  };

  const handleCreateExtraCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!extraChargeData.studentId || extraChargeData.amount <= 0 || !extraChargeData.description) {
      showAlert('Atenção', '⚠️ Por favor, preencha todos os campos da cobrança avulsa.', 'warning');
      return;
    }

    const student = data.students.find(s => s.id === extraChargeData.studentId);
    if (!student) {
      showAlert('Erro', 'Aluno não encontrado.', 'error');
      return;
    }

    const newPayments: Payment[] = [];
    
    let baseDateStr = '';
    if (extraChargeData.firstDueDate.length === 10) {
        baseDateStr = dateBrToIso(extraChargeData.firstDueDate);
    }
    const baseDate = new Date(baseDateStr);
    const installments = extraChargeData.installments || 1;
    const amountPerInstallment = extraChargeData.amount / installments;

    for (let i = 0; i < installments; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(baseDate.getMonth() + i);

      const { fine, ...rest } = extraChargeData;
      const paymentDueDate = dueDate.toISOString().split('T')[0];

      newPayments.push({
        ...rest,
        lateFee: fine,
        id: crypto.randomUUID(),
        studentId: extraChargeData.studentId,
        amount: amountPerInstallment,
        discount: extraChargeData.discount || 0,
        discountType: extraChargeData.discountType || 'fixed',
        interest: extraChargeData.interest || 0,
        dueDate: paymentDueDate,
        status: 'pending',
        type: 'other',
        installmentNumber: installments > 1 ? i + 1 : undefined,
        totalInstallments: installments > 1 ? installments : undefined,
        description: installments > 1 
          ? `${extraChargeData.description} (${i + 1}/${installments})`
          : extraChargeData.description
      });
    }

    try {
      const asaasRequests = newPayments.map(payment => {
        const rawCpf = (student.cpf || student.guardianCpf || '').replace(/\D/g, '');
        // Garantir que a data esteja em formato ISO YYYY-MM-DD (string pura)
        const isoDueDate = payment.dueDate;

        return fetch('/.netlify/functions/gerar_cobranca', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aluno_id: student.id,
            nome: student.name,
            cpf: rawCpf,
            email: student.email,
            valor: payment.amount,
            vencimento: isoDueDate,
            multa: payment.lateFee,
            juros: payment.interest,
            desconto: Number(payment.discount) || 0,
            telefone: student.phone,
            cep: student.addressZip,
            endereco: student.addressStreet,
            numero: student.addressNumber,
            bairro: student.addressNeighborhood,
            nascimento: student.birthDate,
            descricao: payment.description
          })
        });
      });

      const asaasResponses = await Promise.all(asaasRequests);
      const asaasData = await Promise.all(asaasResponses.map(async r => {
        if (r.ok) return r.json();
        return null;
      }));
      
      newPayments.forEach((p, idx) => {
        if (asaasData[idx]) {
          p.asaasPaymentUrl = asaasData[idx].bankSlipUrl;
          p.asaasPaymentId = asaasData[idx].paymentId;
        }
      });
    } catch (error) {
      console.error('Erro ao conectar com o Asaas:', error);
      showAlert('Atenção', 'Erro ao conectar com o Asaas. Lançamentos salvos apenas localmente.', 'warning');
    }

    updateData({ payments: [...data.payments, ...newPayments] });
    closeModal();
  };

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsModalOpen(false);
      setShowHistoryModal(false);
      setShowDeleteModal(false);
      setShowExtraChargeModal(false);
      setIsClosing(false);
      
      setManualInstallments(1);
      const today = new Date();
      setDueDateDisplay(today.toLocaleDateString('pt-BR'));
      setFormData({
        studentId: '',
        amount: 150,
        discount: 0,
        discountType: 'fixed',
        fine: 0,
        interest: 0,
        dueDate: today.toISOString().split('T')[0],
        type: 'monthly',
        description: ''
      });
      setExtraChargeData({
        studentId: '',
        amount: 0,
        installments: 1,
        description: 'Taxa Extra',
        firstDueDate: today.toLocaleDateString('pt-BR'),
        discount: 0,
        discountType: 'fixed',
        fine: 0,
        interest: 0
      });
      setSelectedStudentHistory(null);
      setPaymentToDelete(null);
    }, 300);
  };

  const togglePaymentStatus = (payment: Payment) => {
    const updated = data.payments.map(p => {
      if (p.id === payment.id) {
        const isPaid = p.status === 'paid';
        return {
          ...p,
          status: isPaid ? 'pending' : 'paid',
          paidDate: isPaid ? undefined : new Date().toLocaleDateString('pt-BR')
        };
      }
      return p;
    });
    updateData({ payments: updated });
  };

  const handleDelete = async (deleteType: 'single' | 'all') => {
    if (!paymentToDelete) return;

    let updatedPayments = [...data.payments];

    if (deleteType === 'single') {
      try {
        const response = await fetch('/.netlify/functions/excluir_cobranca', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aluno_id: paymentToDelete.studentId,
            valor: paymentToDelete.amount,
            vencimento: paymentToDelete.dueDate
          })
        });

        if (!response.ok) {
          showAlert('Erro', 'Aviso: Boleto excluído apenas localmente. Não foi possível apagar no Asaas.', 'error');
        }
      } catch (error) {
        console.error('Erro ao excluir no Asaas:', error);
        showAlert('Erro', 'Aviso: Boleto excluído apenas localmente. Não foi possível apagar no Asaas.', 'error');
      }

      updatedPayments = updatedPayments.filter(p => p.id !== paymentToDelete.id);
    } else {
      // Delete all pending payments for this student (or specific contract)
      updatedPayments = updatedPayments.filter(p => {
        const isSameStudent = p.studentId === paymentToDelete.studentId;
        const isPending = p.status !== 'paid'; // Keep history of paid ones usually
        const isSameContract = paymentToDelete.contractId ? p.contractId === paymentToDelete.contractId : true;
        
        // Don't delete if it matches criteria
        return !(isSameStudent && isPending && isSameContract);
      });
    }

    updateData({ payments: updatedPayments });
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

  const handleDownloadReceipt = (payment: Payment) => {
    const student = data.students.find(s => s.id === payment.studentId);
    if (student) {
      pdfService.generatePaymentReceiptPDF(payment, student, data);
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'paid': return <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"><CheckCircle size={12}/> Pago</span>;
      case 'pending': return <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"><Clock size={12}/> Pendente</span>;
      case 'overdue': return <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"><AlertCircle size={12}/> Atrasado</span>;
      default: return null;
    }
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
            onClick={syncAsaasPayments}
            disabled={isSyncing}
            className={`flex-1 sm:flex-none bg-white border border-slate-200 text-slate-700 px-4 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 transition-all shadow-sm font-bold active:scale-95 ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RefreshCw size={20} className={`text-indigo-500 ${isSyncing ? 'animate-spin' : ''}`} /> 
            {isSyncing ? 'Sincronizando...' : 'Sincronizar Asaas'}
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex-1 sm:flex-none bg-indigo-600 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg font-bold active:scale-95"
          >
            <Plus size={20} /> Novo Lançamento
          </button>
          <button 
            onClick={() => setShowExtraChargeModal(true)}
            className="flex-1 sm:flex-none bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 transition-all shadow-sm font-bold active:scale-95"
          >
            <DollarSign size={20} className="text-emerald-500" /> Cobrança Avulsa
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/30 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
              <Filter size={16} className="text-slate-400" />
              <span className="text-[10px] font-bold text-slate-500 uppercase">Filtros:</span>
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
                  {status === 'all' ? 'Status: Todos' : status === 'paid' ? 'Pagos' : status === 'pending' ? 'Pendentes' : 'Atrasados'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select 
                className={`${inputClass} w-full pl-9`}
                value={filterStudent}
                onChange={e => setFilterStudent(e.target.value)}
              >
                <option value="all">Todos os Alunos</option>
                {data.students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="relative">
              <BookOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select 
                className={`${inputClass} w-full pl-9`}
                value={filterClass}
                onChange={e => setFilterClass(e.target.value)}
              >
                <option value="all">Todas as Turmas</option>
                {data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
              {filteredPayments.map(payment => {
                const student = data.students.find(s => s.id === payment.studentId);
                return (
                  <tr key={payment.id} className="hover:bg-indigo-50/30 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="font-bold text-slate-900 flex items-center gap-2">
                        {student?.name || 'Aluno Removido'}
                        <button onClick={() => student && openHistory(student.id)} className="text-slate-400 hover:text-indigo-600 transition-colors" title="Ver Histórico do Aluno">
                          <Eye size={14} />
                        </button>
                      </div>
                      <div className="text-[10px] font-black text-indigo-500 uppercase tracking-wide">
                        {payment.type === 'registration' ? 'Matrícula' : 'Mensalidade'} 
                        {payment.installmentNumber && <span> {payment.installmentNumber}/{payment.totalInstallments}</span>}
                      </div>
                      {payment.description && <div className="text-[10px] text-slate-400 mt-0.5">{payment.description}</div>}
                    </td>
                    <td className="px-6 py-5 text-slate-600 text-sm font-medium">
                      {new Date(payment.dueDate).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-5">
                      <div className="font-black text-slate-900">R$ {payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                      {payment.discount && payment.discount > 0 && (
                        <div className="text-[10px] text-emerald-600 font-bold">- Desc: R$ {payment.discount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                      )}
                    </td>
                    <td className="px-6 py-5">{getStatusBadge(payment.status)}</td>
                    <td className="px-6 py-5 text-right flex justify-end gap-2">
                      <button onClick={() => handleDownloadReceipt(payment)} className="p-2 text-slate-400 hover:text-indigo-600 transition-all" title="Recibo"><Printer size={18} /></button>
                      <button onClick={() => togglePaymentStatus(payment)} className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase border transition-all ${payment.status === 'paid' ? 'text-slate-400 border-slate-200' : 'text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}>{payment.status === 'paid' ? 'Estornar' : 'Baixar'}</button>
                      <button onClick={() => openDelete(payment)} className="p-2 text-slate-400 hover:text-red-600 transition-all" title="Excluir"><Trash2 size={18} /></button>
                    </td>
                  </tr>
                );
              })}
              {filteredPayments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-slate-400 italic">
                    Nenhum lançamento encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEW PAYMENT MODAL */}
      {isModalOpen && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}>
          <div className={`bg-white rounded-xl w-full max-w-lg shadow-2xl my-auto transition-all duration-300 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100 animate-zoom-in'}`}>
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
              <div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight">Novo Lançamento</h3>
                <p className="text-xs text-slate-500">Registre cobranças manuais ou parceladas.</p>
              </div>
              <button onClick={closeModal} className="p-2 bg-white text-slate-400 hover:text-red-500 rounded-lg shadow-sm transition-all hover:rotate-90"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreatePayment} className="p-6 space-y-4">
              <SearchableSelect
                label="Aluno Beneficiário"
                placeholder="Selecione o aluno..."
                required
                options={data.students.map(s => ({
                  id: s.id,
                  name: s.name,
                  subtext: data.classes.find(c => c.id === s.classId)?.name || 'Sem Turma'
                }))}
                value={formData.studentId}
                onChange={val => setFormData({...formData, studentId: val})}
              />
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Referente a (Opcional)</label>
                <select className={inputClass + " w-full"} value={selectedItemId} onChange={handleItemSelect}>
                  <option value="">Lançamento Avulso / Personalizado</option>
                  <optgroup label="Cursos">
                    {data.courses?.map(c => <option key={`course_${c.id}`} value={`course_${c.id}`}>{c.name} - R$ {c.monthlyFee.toFixed(2)}</option>)}
                  </optgroup>
                  <optgroup label="Apostilas">
                    {data.handouts?.map(h => <option key={`handout_${h.id}`} value={`handout_${h.id}`}>{h.name} - R$ {h.price.toFixed(2)}</option>)}
                  </optgroup>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Tipo</label>
                  <select className={inputClass + " w-full"} value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})}>
                    <option value="monthly">Mensalidade</option>
                    <option value="registration">Matrícula</option>
                    <option value="other">Outros</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1 flex items-center gap-1"><Hash size={12}/> Qtd. Parcelas</label>
                  <input type="number" min="1" max="100" required className={inputClass + " w-full"} value={manualInstallments} onChange={e => setManualInstallments(parseInt(e.target.value) || 1)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Valor Base (R$)</label>
                  <input type="number" step="0.01" required className={inputClass + " w-full"} value={formData.amount} onChange={e => setFormData({...formData, amount: parseFloat(e.target.value)})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1 flex items-center gap-1"><Tag size={12}/> Desconto (R$)</label>
                  <input type="number" step="0.01" className={inputClass + " w-full"} value={formData.discount} onChange={e => setFormData({...formData, discount: parseFloat(e.target.value)})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Multa (%)</label>
                  <input type="number" step="0.01" className={inputClass + " w-full"} value={formData.fine} onChange={e => setFormData({...formData, fine: parseFloat(e.target.value) || 0})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Juros ao Mês (%)</label>
                  <input type="number" step="0.01" className={inputClass + " w-full"} value={formData.interest} onChange={e => setFormData({...formData, interest: parseFloat(e.target.value) || 0})} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Data Vencimento Inicial</label>
                <input 
                  required 
                  placeholder="DD/MM/AAAA" 
                  className={inputClass + " w-full"} 
                  value={dueDateDisplay} 
                  onChange={e => {
                    const masked = formatDateMask(e.target.value);
                    setDueDateDisplay(masked);
                    if (masked.length === 10) {
                      setFormData(prev => ({...prev, dueDate: dateBrToIso(masked)}));
                    }
                  }} 
                  maxLength={10}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Descrição</label>
                <input placeholder="Ex: Referente a Janeiro/2024" className={inputClass + " w-full"} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
              </div>
              <div className="pt-4 flex gap-4">
                <button type="button" onClick={closeModal} className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors font-bold text-xs">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-lg font-bold text-xs">Gerar Lançamento</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STUDENT HISTORY MODAL */}
      {showHistoryModal && selectedStudentHistory && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}>
          <div className={`bg-white rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] my-auto transition-all duration-300 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100 animate-zoom-in'}`}>
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                  <User size={20} className="text-indigo-600"/> {selectedStudentHistory.name}
                </h3>
                <p className="text-xs text-slate-500">Histórico completo de pagamentos.</p>
              </div>
              <button onClick={closeModal} className="p-2 bg-white text-slate-400 hover:text-red-500 rounded-lg shadow-sm transition-all hover:rotate-90"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-0">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3">Vencimento</th>
                    <th className="px-4 py-3">Valor</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.payments.filter(p => p.studentId === selectedStudentHistory.id).sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-700">{p.description || (p.type === 'monthly' ? 'Mensalidade' : 'Taxa')}</div>
                        {p.installmentNumber && <div className="text-[9px] text-slate-400">{p.installmentNumber}/{p.totalInstallments}</div>}
                      </td>
                      <td className="px-4 py-3">{new Date(p.dueDate).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-3">R$ {p.amount.toFixed(2)}</td>
                      <td className="px-4 py-3">{getStatusBadge(p.status)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => { closeModal(); openDelete(p); }} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 text-right">
              <button onClick={closeModal} className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-600 font-bold text-xs hover:bg-slate-100">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && paymentToDelete && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}>
          <div className={`bg-white rounded-xl w-full max-w-sm shadow-2xl my-auto transition-all duration-300 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100 animate-zoom-in'}`}>
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-black text-slate-800 mb-2">Excluir Pagamento</h3>
              <p className="text-sm text-slate-500 mb-6">Como deseja excluir este lançamento?</p>
              
              <div className="flex flex-col gap-2">
                <button onClick={() => handleDelete('single')} className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-all">
                  Excluir Apenas Esta
                </button>
                {(paymentToDelete.contractId || paymentToDelete.totalInstallments) && (
                  <button onClick={() => handleDelete('all')} className="w-full py-3 bg-white border-2 border-red-100 text-red-600 rounded-xl font-bold text-sm hover:bg-red-50 transition-all">
                    Excluir Todas Restantes
                  </button>
                )}
                <button onClick={closeModal} className="w-full py-3 text-slate-400 font-bold text-sm hover:text-slate-600 mt-2">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXTRA CHARGE MODAL (formerly Bulk Generate) */}
      {showExtraChargeModal && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}>
          <div className={`bg-white rounded-xl w-full max-w-md shadow-2xl my-auto transition-all duration-300 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100 animate-zoom-in'}`}>
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-emerald-50">
              <div>
                <h3 className="text-xl font-black text-slate-800">Cobrança Avulsa / Extra</h3>
                <p className="text-xs text-emerald-800">Gere cobranças específicas para um aluno.</p>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            <form onSubmit={handleCreateExtraCharge} className="p-6 space-y-4">
              <SearchableSelect
                label="Selecione o Aluno"
                placeholder="Selecione o aluno..."
                required
                options={data.students.map(s => ({
                  id: s.id,
                  name: s.name,
                  subtext: data.classes.find(c => c.id === s.classId)?.name || 'Sem Turma'
                }))}
                value={extraChargeData.studentId}
                onChange={val => setExtraChargeData({...extraChargeData, studentId: val})}
              />
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição</label>
                <input 
                  required
                  className={inputClass + " w-full"} 
                  placeholder="Ex: Material Didático"
                  value={extraChargeData.description} 
                  onChange={e => setExtraChargeData({...extraChargeData, description: e.target.value})} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor Total (R$)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    className={inputClass + " w-full"} 
                    value={extraChargeData.amount} 
                    onChange={e => setExtraChargeData({...extraChargeData, amount: parseFloat(e.target.value)})} 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Parcelas</label>
                  <input 
                    type="number" 
                    min="1" 
                    required 
                    className={inputClass + " w-full"} 
                    value={extraChargeData.installments} 
                    onChange={e => setExtraChargeData({...extraChargeData, installments: parseInt(e.target.value) || 1})} 
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Multa (%)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className={inputClass + " w-full"} 
                    value={extraChargeData.fine} 
                    onChange={e => setExtraChargeData({...extraChargeData, fine: parseFloat(e.target.value) || 0})} 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Juros ao Mês (%)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className={inputClass + " w-full"} 
                    value={extraChargeData.interest} 
                    onChange={e => setExtraChargeData({...extraChargeData, interest: parseFloat(e.target.value) || 0})} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vencimento (1ª Parcela)</label>
                <input 
                  required 
                  className={inputClass + " w-full"} 
                  placeholder="DD/MM/AAAA"
                  maxLength={10}
                  value={extraChargeData.firstDueDate} 
                  onChange={e => setExtraChargeData({...extraChargeData, firstDueDate: formatDateMask(e.target.value)})} 
                />
              </div>
              
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 text-xs">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 text-xs">
                  Gerar Cobrança
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Finance;