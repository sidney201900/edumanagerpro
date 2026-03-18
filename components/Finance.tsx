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
  
  // Modais states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPrintCarneModal, setShowPrintCarneModal] = useState(false);
  
  // Selection states
  const [selectedStudentHistory, setSelectedStudentHistory] = useState<Student | null>(null);
  const [selectedStudentForCarne, setSelectedStudentForCarne] = useState<string>('');
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
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
          showAlert('Atenção', `${type === 'boleto' ? 'Boleto' : 'Recibo'} não disponível.`, 'warning');
        }
      } else {
        showAlert('Erro', result.error || `Falha ao buscar ${type}.`, 'error');
      }
    } catch (error) {
      console.error(`Erro ao buscar ${type}:`, error);
      showAlert('Erro', 'Ocorreu um erro ao processar sua solicitação.', 'error');
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
            if (p.asaasPaymentId) {
              return cp.asaas_payment_id === p.asaasPaymentId;
            }
            return cp.aluno_id === p.studentId && 
                   Math.abs(cp.valor - p.amount) < 0.01 && 
                   cp.vencimento === p.dueDate;
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
          
          const hasOverdue = updatedPayments.some((p, idx) => {
            const oldP = currentPayments[idx];
            return oldP && oldP.status !== 'overdue' && p.status === 'overdue';
          });
          
          const hasPaid = updatedPayments.some((p, idx) => {
            const oldP = currentPayments[idx];
            return oldP && oldP.status !== 'paid' && p.status === 'paid';
          });

          let message = `${updatedCount} pagamento(s) atualizado(s).`;
          if (hasPaid && !hasOverdue) message = 'Pagamento confirmado e registrado.';
          if (hasOverdue && !hasPaid) message = 'Status atualizado para Atrasado.';
          if (hasPaid && hasOverdue) message = 'Pagamentos e atrasos atualizados.';

          showAlert('Sincronização', message, 'success');
        }
      }
    } catch (error) {
      console.error('Erro ao sincronizar pagamentos:', error);
      showAlert('Erro', 'Falha ao sincronizar com o Asaas.', 'error');
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

        setFormData(prev => ({
          ...prev,
          fine: fine,
          interest: interest
        }));
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
      if (filterType === 'avulsas') {
        typeMatch = !p.installmentId;
      } else if (filterType === 'parcelamentos') {
        typeMatch = !!p.installmentId;
      }

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
    setExpandedInstallments(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
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
      setFormData(prev => ({
        ...formData,
        amount: 150,
        description: 'Taxa de Matrícula',
        type: 'registration'
      }));
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
          nascimento: student.birthDate,
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
            if (asaasData.installment) {
              p.installmentId = asaasData.installment;
            }
          });
        }
      } else {
        throw new Error('Erro na resposta da API');
      }
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
    showAlert('Sucesso', 'Nova cobrança gerada com sucesso.', 'success');
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
      setSelectedStudentHistory(null);
      setPaymentToDelete(null);
    }, 300);
  };

  // LOGICA CORRIGIDA: Identifica corretamente inst_ e pay_ para o Backend
  const handleDelete = async (deleteType: 'single' | 'all') => {
    if (!paymentToDelete) return;

    let idToDelete = '';
    
    if (deleteType === 'all') {
      idToDelete = paymentToDelete.installmentId || (paymentToDelete as any).asaasIdParaExcluir || paymentToDelete.id;
    } else {
      idToDelete = paymentToDelete.asaasPaymentId || paymentToDelete.id;
    }

    if (!idToDelete) {
      showAlert('Erro', 'ID da cobrança não encontrado.', 'error');
      return;
    }

    try {
      showAlert('Aguarde', deleteType === 'all' ? 'Excluindo carnê completo...' : 'Excluindo parcela...', 'info');
      const response = await fetch('/api/excluir_cobranca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: idToDelete })
      });

      if (response.ok) {
        showAlert('Sucesso', 'Excluído no sistema e Asaas.', 'success');
        
        let updatedPayments = [...data.payments];
        if (idToDelete.startsWith('inst_') || deleteType === 'all') {
          updatedPayments = updatedPayments.filter(p => p.installmentId !== idToDelete && p.id !== idToDelete);
        } else {
          updatedPayments = updatedPayments.filter(p => p.asaasPaymentId !== idToDelete && p.id !== idToDelete);
        }
        updateData({ payments: updatedPayments });
      } else {
        const result = await response.json();
        showAlert('Atenção', result.error || 'Erro na exclusão.', 'warning');
      }
    } catch (error) {
      console.error('Erro ao excluir:', error);
      showAlert('Erro', 'Falha na comunicação com o servidor.', 'error');
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
      
      if (paidDate) {
        dueDate.setHours(0,0,0,0);
        paidDate.setHours(0,0,0,0);
        
        if (paidDate <= dueDate) {
