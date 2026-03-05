import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { SchoolData, Student, Contract, Payment, Class } from '../types';

/**
 * Helper to add header/logo to PDF
 */
export const addHeader = (doc: any, schoolData: SchoolData) => {
  const profile = schoolData.profile;
  
  if (profile.logo) {
    try {
      const format = profile.logo.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
      doc.addImage(profile.logo, format, 20, 10, 25, 25, undefined, 'FAST');
    } catch (e) {
      console.warn("Logo image failed to load in PDF", e);
    }
  }

  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.text(profile.name || 'EduManager School', 50, 18);
  
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.setFont('helvetica', 'normal');
  doc.text(`CNPJ: ${profile.cnpj || 'Não informado'}`, 50, 23);
  doc.text(profile.address || '', 50, 27);
  doc.text(`${profile.phone || ''} ${profile.email ? '| ' + profile.email : ''}`, 50, 31);
  
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(20, 38, 190, 38);
  return 45;
};

export const pdfService = {
  generateStudentRegistrationPDF: (student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = addHeader(doc, schoolData);
    const cls = schoolData.classes.find(c => c.id === student.classId);
    const course = schoolData.courses.find(c => c.id === cls?.courseId);

    // Title
    doc.setFontSize(18);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('FICHA DE MATRÍCULA', 105, startY + 10, { align: 'center' });
    
    // Student Photo Placeholder if exists
    if (student.photo) {
      try {
        const format = student.photo.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
        doc.addImage(student.photo, format, 160, startY + 20, 30, 30, undefined, 'FAST');
        doc.setDrawColor(200);
        doc.rect(160, startY + 20, 30, 30);
      } catch (e) {
        doc.setDrawColor(226, 232, 240);
        doc.rect(160, startY + 20, 30, 30);
        doc.setFontSize(7);
        doc.text('FOTO', 175, startY + 37, { align: 'center' });
      }
    } else {
      doc.setDrawColor(226, 232, 240);
      doc.rect(160, startY + 20, 30, 30);
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text('SEM FOTO', 175, startY + 37, { align: 'center' });
    }

    let currentY = startY + 25;

    // Section: Dados Pessoais
    doc.setFontSize(11);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('1. DADOS DO ALUNO', 20, currentY);
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.2);
    doc.line(20, currentY + 2, 155, currentY + 2);

    currentY += 10;
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text('NOME COMPLETO:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(student.name, 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('CPF:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(student.cpf || 'Não informado', 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('RG:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    const rgIssue = student.rgIssueDate ? ` (Exp: ${new Date(student.rgIssueDate).toLocaleDateString('pt-BR')})` : '';
    doc.text(`${student.rg || 'Não informado'}${rgIssue}`, 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('NASCIMENTO:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    const birth = new Date(student.birthDate);
    const ageStr = student.birthDate ? ` (${new Date().getFullYear() - birth.getFullYear()} anos)` : '';
    doc.text((student.birthDate ? birth.toLocaleDateString('pt-BR') : '---') + ageStr, 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('TELEFONE:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(student.phone, 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('E-MAIL:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(student.email, 55, currentY);

    // Conditional Section: Responsável
    if (student.guardianName) {
      currentY += 12;
      doc.setFontSize(11);
      doc.setTextColor(79, 70, 229);
      doc.setFont('helvetica', 'bold');
      doc.text('1.1 DADOS DO RESPONSÁVEL', 20, currentY);
      doc.setDrawColor(79, 70, 229);
      doc.setLineWidth(0.2);
      doc.line(20, currentY + 2, 190, currentY + 2);

      currentY += 10;
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.text('NOME:', 20, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(student.guardianName, 55, currentY);

      currentY += 7;
      doc.setFont('helvetica', 'bold');
      doc.text('CPF:', 20, currentY);
      doc.setFont('helvetica', 'normal');
      doc.text(student.guardianCpf || '---', 55, currentY);
    }

    // Section: Informações do Curso
    currentY += 15;
    doc.setFontSize(11);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('2. INFORMAÇÕES ACADÊMICAS', 20, currentY);
    doc.line(20, currentY + 2, 190, currentY + 2);

    currentY += 10;
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text('CURSO:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(course?.name || 'Não vinculado', 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('TURMA:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(cls?.name || 'Não atribuída', 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('PROFESSOR:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(cls?.teacher || 'N/A', 55, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('HORÁRIO:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(cls?.schedule || 'N/A', 55, currentY);

    // Section: Status e Registro
    currentY += 15;
    doc.setFontSize(11);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('3. STATUS DA MATRÍCULA', 20, currentY);
    doc.line(20, currentY + 2, 190, currentY + 2);

    currentY += 10;
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text('DATA DE MATRÍCULA:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(new Date(student.registrationDate).toLocaleDateString('pt-BR'), 65, currentY);

    currentY += 7;
    doc.setFont('helvetica', 'bold');
    doc.text('SITUAÇÃO ATUAL:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(student.status === 'active' ? 'ATIVO / REGULAR' : 'INATIVO / TRANCADO', 65, currentY);

    // Footer - Signatures
    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Documento gerado eletronicamente em: ' + new Date().toLocaleString('pt-BR'), 105, pageHeight - 15, { align: 'center' });
    
    doc.setDrawColor(200);
    doc.line(25, pageHeight - 45, 90, pageHeight - 45);
    doc.text(student.guardianName ? 'ASSINATURA RESPONSÁVEL' : 'ASSINATURA DO ALUNO', 57.5, pageHeight - 40, { align: 'center' });

    doc.line(120, pageHeight - 45, 185, pageHeight - 45);
    doc.text('COORDENAÇÃO ESCOLAR', 152.5, pageHeight - 40, { align: 'center' });

    doc.save(`ficha_cadastro_${student.name.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  },

  generateStudentHistoryPDF: (student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = addHeader(doc, schoolData);
    const payments = schoolData.payments.filter(p => p.studentId === student.id);
    const contracts = schoolData.contracts.filter(c => c.studentId === student.id);

    doc.setFontSize(16);
    doc.setTextColor(79, 70, 229);
    doc.text(`Histórico Acadêmico e Financeiro: ${student.name}`, 105, startY + 5, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text('Contratos Ativos', 20, startY + 20);
    
    doc.autoTable({
      startY: startY + 25,
      margin: { top: 45 },
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) addHeader(doc, schoolData);
      },
      head: [['Título', 'Data Emissão']],
      body: contracts.map(c => [
        c.title,
        new Date(c.createdAt).toLocaleDateString('pt-BR')
      ]),
      headStyles: { fillColor: [79, 70, 229] }
    });

    const nextY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(12);
    doc.text('Histórico de Pagamentos', 20, nextY);

    doc.autoTable({
      startY: nextY + 5,
      margin: { top: 45 },
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) addHeader(doc, schoolData);
      },
      head: [['Descrição', 'Vencimento', 'Valor', 'Status']],
      body: payments.map(p => [
        p.description || (p.type === 'registration' ? 'Matrícula' : 'Mensalidade'),
        new Date(p.dueDate).toLocaleDateString('pt-BR'),
        `R$ ${p.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        p.status === 'paid' ? 'Pago' : p.status === 'overdue' ? 'Atrasado' : 'Pendente'
      ]),
      headStyles: { fillColor: [30, 41, 59] }
    });

    doc.save(`historico_${student.name.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  },

  generatePaymentReceiptPDF: (payment: Payment, student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, 190, 140); // Border

    const profile = schoolData.profile;
    if (profile.logo) {
       const format = profile.logo.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
       doc.addImage(profile.logo, format, 20, 15, 20, 20, undefined, 'FAST');
    }
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(profile.name, 45, 18);
    doc.setFontSize(8);
    doc.text(`CNPJ: ${profile.cnpj || '---'}`, 45, 22);
    doc.text(profile.address || '', 45, 26);

    doc.setFontSize(16);
    doc.setTextColor(79, 70, 229);
    doc.text('RECIBO DE PAGAMENTO', 105, 45, { align: 'center' });

    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Nº do Documento: ${payment.id.substring(0, 8).toUpperCase()}`, 150, 55);

    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text(`Recebemos de: ${student.name}`, 20, 70);
    doc.text(`CPF: ${student.cpf || '---'}`, 20, 76);
    doc.text(`A quantia de: R$ ${payment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 20, 85);
    
    const typeLabel = payment.type === 'registration' ? 'Taxa de Matrícula' : 
                      payment.type === 'monthly' ? 'Mensalidade do Curso' : 'Outros Serviços';
    
    doc.text(`Referente a: ${typeLabel} ${payment.description ? `(${payment.description})` : ''}`, 20, 95);
    doc.text(`Data de Vencimento: ${new Date(payment.dueDate).toLocaleDateString('pt-BR')}`, 20, 105);
    
    if (payment.status === 'paid' && payment.paidDate) {
      doc.setFontSize(12);
      doc.setTextColor(16, 185, 129);
      doc.text(`PAGO EM: ${payment.paidDate}`, 105, 120, { align: 'center' });
    }

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);
    doc.text('_________________________________', 105, 140, { align: 'center' });
    doc.text('Assinatura / Carimbo', 105, 145, { align: 'center' });

    doc.save(`recibo_${student.name.replace(/\s+/g, '_').toLowerCase()}_${payment.id.substring(0, 4)}.pdf`);
  },

  generateContractPDF: (contract: Contract, student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    let currentY = addHeader(doc, schoolData);
    
    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text(contract.title, 105, currentY + 10, { align: 'center' });
    
    currentY += 25;
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    doc.text(`Data de Emissão: ${new Date(contract.createdAt).toLocaleDateString('pt-BR')}`, 20, currentY);
    doc.text(`Contratante: ${student.name} (CPF: ${student.cpf || '---'})`, 20, currentY + 5);
    
    // Use autoTable for the content to handle pagination and performance perfectly
    // Split content by newlines to create separate rows, which helps autoTable paginate correctly
    const paragraphs = contract.content.split('\n').filter(p => p.trim() !== '');
    const bodyData = paragraphs.map(p => [p]);

    doc.autoTable({
      startY: currentY + 15,
      body: bodyData,
      theme: 'plain',
      styles: {
        fontSize: 10,
        cellPadding: { top: 2, bottom: 2, left: 0, right: 0 },
        overflow: 'linebreak',
        textColor: [30, 41, 59],
        font: 'helvetica',
        fontStyle: 'normal'
      },
      margin: { top: 45, bottom: 60, left: 20, right: 20 },
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) addHeader(doc, schoolData);
      }
    });

    let finalY = (doc as any).lastAutoTable.finalY + 20;
    const pageHeight = doc.internal.pageSize.height;

    // Check if signatures fit on the current page
    if (finalY > pageHeight - 40) {
      doc.addPage();
      addHeader(doc, schoolData);
      finalY = 60;
    }

    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.text('_________________________________', 105, finalY, { align: 'center' });
    
    doc.setFontSize(9);
    const signatureLabel = student.guardianName 
      ? `ASSINATURA DO RESPONSÁVEL: ${student.guardianName}`
      : `ASSINATURA DO ALUNO: ${student.name}`;
      
    doc.text(signatureLabel, 105, finalY + 5, { align: 'center' });
    
    doc.save(`contrato_${contract.title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  },

  generateClassListPDF: (cls: Class, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = addHeader(doc, schoolData);
    const course = schoolData.courses.find(c => c.id === cls.courseId);
    const students = schoolData.students.filter(s => s.classId === cls.id);

    doc.setFontSize(16);
    doc.setTextColor(79, 70, 229);
    doc.text(`Relatório de Turma: ${cls.name}`, 105, startY + 5, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(`Curso: ${course?.name || 'N/A'}`, 20, startY + 15);
    doc.text(`Professor: ${cls.teacher}`, 20, startY + 22);
    doc.text(`Horário: ${cls.schedule}`, 20, startY + 29);
    
    doc.autoTable({
      startY: startY + 35,
      margin: { top: 45 },
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) addHeader(doc, schoolData);
      },
      head: [['Nº', 'Nome do Aluno', 'Telefone', 'Status']],
      body: students.map((s, idx) => [
        idx + 1,
        s.name,
        s.phone,
        s.status === 'active' ? 'Ativo' : 'Inativo'
      ]),
      headStyles: { fillColor: [79, 70, 229] }
    });

    doc.save(`turma_${cls.name.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  },

  generateStudentListPDF: (schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = addHeader(doc, schoolData);

    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.text('Relatório Geral de Alunos', 105, startY + 5, { align: 'center' });

    doc.autoTable({
      startY: startY + 15,
      margin: { top: 45 },
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) addHeader(doc, schoolData);
      },
      head: [['Nome', 'CPF', 'Email', 'Turma', 'Status']],
      body: schoolData.students.map(s => {
        const cls = schoolData.classes.find(c => c.id === s.classId);
        return [
          s.name,
          s.cpf || '-',
          s.email,
          cls?.name || '-',
          s.status === 'active' ? 'Ativo' : 'Inativo'
        ];
      }),
      headStyles: { fillColor: [30, 41, 59] }
    });

    doc.save(`lista_alunos_${new Date().toISOString().split('T')[0]}.pdf`);
  },

  generateFullSchoolReportPDF: (schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = addHeader(doc, schoolData);
    
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text('Relatório Consolidado', 105, startY + 5, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text('Visão Geral', 20, startY + 20);
    doc.setFontSize(10);
    doc.text(`Total Alunos: ${schoolData.students.length}`, 20, startY + 28);
    doc.text(`Alunos Ativos: ${schoolData.students.filter(s => s.status === 'active').length}`, 20, startY + 34);
    doc.text(`Turmas Ativas: ${schoolData.classes.length}`, 20, startY + 40);

    doc.autoTable({
      startY: startY + 50,
      margin: { top: 45 },
      didDrawPage: (data: any) => {
        if (data.pageNumber > 1) addHeader(doc, schoolData);
      },
      head: [['Alunos', 'Turmas', 'Financeiro Pago', 'Pendente']],
      body: [[
        schoolData.students.length,
        schoolData.classes.length,
        `R$ ${schoolData.payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0).toFixed(2)}`,
        `R$ ${schoolData.payments.filter(p => p.status !== 'paid').reduce((sum, p) => sum + p.amount, 0).toFixed(2)}`
      ]],
      headStyles: { fillColor: [30, 41, 59] }
    });

    doc.save(`relatorio_geral_${new Date().toISOString().split('T')[0]}.pdf`);
  }
};