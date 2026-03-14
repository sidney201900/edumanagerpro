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
                   Math.abs(cp.valor - p.amount)