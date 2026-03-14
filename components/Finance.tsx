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
        .select('asaas_payment_id, status, aluno_id, valor, vencimento, data_pagamento, installment, link_boleto');

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
            
            if (p.status !== newStatus || p.amount !== match.valor || p.installmentId !== match.installment || p.asaasPaymentUrl !== match.link_boleto || p.asaasPaymentId !== match.asaas_payment_id) {
              updatedCount++;
              return { 
                ...p, 
                status: newStatus as any, 
                amount: match.valor,
                paidDate: match.data_pagamento || p.paidDate,
                installmentId: match.installment || p.installmentId,
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

  // Form helpers
  const [manualInstallments, setManualInstallments] = useState(1);
  const [dueDateDisplay, setDueDateDisplay] = useState(new Date().toLocaleDateString('pt-BR'));
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedItemType, setSelectedItemType] = useState<'course' | 'handout' | ''>('');
  
  const [formData, setFormData] = useState({
    studentId: '', amount: 150, discount: 0, fine: 0, interest: 0,
    dueDate: new Date().toISOString().split('T')[0], type: 'monthly' as any, description: ''
  });

  const formatDateMask = (val: string) => val.replace(/\D/g, '').replace(/(\d{2})(\d)/, '$1/$2').replace(/(\d{2})(\d)/, '$1/$2').slice(0, 10);
  const dateBrToIso = (br: string) => { if (br.length !== 10) return ''; const [d, m, y] = br.split('/'); return `${y}-${m}-${d}`; };

  const filteredPayments = data.payments
    .filter(p => {
      const statusMatch = filterStatus === 'all' || p.status === filterStatus;
      const studentMatch = filterStudent === 'all' || p.studentId === filterStudent;
      const typeMatch = filterType === 'all' || (filterType === 'avulsas' ? !p.installmentId : !!p.installmentId);
      return statusMatch && studentMatch && typeMatch;
    })
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const groupedInstallments = useMemo(() => {
    const groups: Record<string, Payment[]> = {};
    filteredPayments.forEach(p => { if (p.installmentId) { if (!groups[p.installmentId]) groups[p.installmentId] = []; groups[p.installmentId].push(p); } });
    return Object.entries(groups).map(([id, payments]) => {
      const sorted = payments.sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0));
      return { installmentId: id, payments: sorted, studentId: sorted[0].studentId, totalAmount: sorted.reduce((sum, p) => sum + p.amount, 0), description: sorted[0].description?.split(' (')[0] || 'Parcelamento', dueDate: sorted[0].dueDate };
    });
  }, [filteredPayments]);

  const toggleInstallment = (id: string) => setExpandedInstallments(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleItemSelect = (e: any) => {
    const val = e.target.value;
    setSelectedItemId(val);
    if (val.startsWith('course_')) {
      const c = data.courses.find(course => course.id === val.replace('course_', ''));
      if (c) setFormData({...formData, amount: c.monthlyFee, description: `Mensalidade - ${c.name}`, type: 'monthly', fine: c.finePercentage || 0, interest: c.interestPercentage || 0});
    }
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const student = data.students.find(s => s.id === formData.studentId);
    if (!student) return;

    const newPayments: Payment[] = [];
    const baseDate = new Date(formData.dueDate);

    for (let i = 0; i < manualInstallments; i++) {
      const d = new Date(baseDate); d.setMonth(baseDate.getMonth() + i);
      newPayments.push({
        ...formData, id: crypto.randomUUID(), status: 'pending', dueDate: d.toISOString().split('T')[0],
        installmentNumber: manualInstallments > 1 ? i + 1 : undefined,
        totalInstallments: manualInstallments >