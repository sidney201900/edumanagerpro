import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { SchoolData, Student, Contract, Payment, Class } from '../types';
import { getImageDimensions } from './imageService';

/**
 * Helper to calculate proportional dimensions and add image to PDF
 */
const addImageProportional = async (doc: any, src: string, x: number, y: number, maxW: number, maxH: number) => {
  try {
    const { width, height } = await getImageDimensions(src);
    const ratio = width / height;
    
    let finalW = maxW;
    let finalH = maxW / ratio;
    
    if (finalH > maxH) {
      finalH = maxH;
      finalW = maxH * ratio;
    }
    
    // Center in the box
    const offsetX = (maxW - finalW) / 2;
    const offsetY = (maxH - finalH) / 2;
    
    const format = src.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
    doc.addImage(src, format, x + offsetX, y + offsetY, finalW, finalH, undefined, 'FAST');
    return { width: finalW, height: finalH };
  } catch (e) {
    console.warn("Image failed to load in PDF", e);
    return null;
  }
};

/**
 * Helper to process and add a 3x4 student photo with center crop and compression
 */
const addStudentPhoto3x4 = async (doc: any, src: string, x: number, y: number) => {
  return new Promise<{ width: number, height: number } | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // 300x400 for 300 DPI approx (30mm x 40mm)
      const targetW = 354; // 30mm at 300 DPI is approx 354px
      const targetH = 472; // 40mm at 300 DPI is approx 472px
      
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      const imgRatio = img.width / img.height;
      const targetRatio = targetW / targetH;

      let sourceW, sourceH, sourceX, sourceY;

      if (imgRatio > targetRatio) {
        // Image is wider than 3x4 - crop sides
        sourceH = img.height;
        sourceW = img.height * targetRatio;
        sourceX = (img.width - sourceW) / 2;
        sourceY = 0;
      } else {
        // Image is taller than 3x4 - crop top/bottom
        sourceW = img.width;
        sourceH = img.width / targetRatio;
        sourceX = 0;
        sourceY = (img.height - sourceH) / 2;
      }

      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, targetW, targetH);
      
      // Compress to JPEG with 0.6 quality for instant opening
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      doc.addImage(dataUrl, 'JPEG', x, y, 30, 40, undefined, 'FAST');
      resolve({ width: 30, height: 40 });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
};

/**
 * Helper to add header/logo to PDF
 */
export const addHeader = async (doc: any, schoolData: SchoolData) => {
  const profile = schoolData.profile;
  
  if (profile.logo) {
    await addImageProportional(doc, profile.logo, 20, 10, 25, 25);
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
  generateStudentRegistrationPDF: async (student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = await addHeader(doc, schoolData);
    const cls = schoolData.classes.find(c => c.id === student.classId);
    const course = schoolData.courses.find(c => c.id === cls?.courseId);

    // Title - Professional Vector Text
    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text('FICHA DE MATRÍCULA E REGISTRO ACADÊMICO', 105, startY + 12, { align: 'center' });
    
    // Photo Positioning - Standard 3x4cm (30mm x 40mm)
    const photoX = 160;
    const photoY = startY + 20;
    
    if (student.photo) {
      const imgResult = await addStudentPhoto3x4(doc, student.photo, photoX, photoY);
      if (!imgResult) {
        doc.setDrawColor(200);
        doc.setLineWidth(0.1);
        doc.rect(photoX, photoY, 30, 40);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text('FOTO 3X4', photoX + 15, photoY + 22, { align: 'center' });
      } else {
        // Border around photo
        doc.setDrawColor(30, 41, 59);
        doc.setLineWidth(0.2);
        doc.rect(photoX, photoY, 30, 40);
      }
    } else {
      doc.setDrawColor(200);
      doc.setLineWidth(0.1);
      doc.rect(photoX, photoY, 30, 40);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('FOTO 3X4', photoX + 15, photoY + 22, { align: 'center' });
    }

    let currentY = startY + 25;

    // Section: Dados Pessoais
    doc.setFontSize(10);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('1. DADOS IDENTIFICADORES DO DISCENTE', 20, currentY);
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.3);
    doc.line(20, currentY + 2, 155, currentY + 2);

    currentY += 10;
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    
    const drawField = (label: string, value: string, x: number, y: number, labelW: number) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, x, y);
      doc.setFont('helvetica', 'normal');
      doc.text(value || '---', x + labelW, y);
    };

    drawField('NOME COMPLETO:', student.name, 20, currentY, 35);
    currentY += 7;
    drawField('CPF:', student.cpf, 20, currentY, 35);
    currentY += 7;
    
    const rgIssue = student.rgIssueDate ? ` (Exp: ${new Date(student.rgIssueDate).toLocaleDateString('pt-BR')})` : '';
    drawField('RG:', `${student.rg || ''}${rgIssue}`, 20, currentY, 35);
    currentY += 7;

    const birth = new Date(student.birthDate);
    const ageStr = student.birthDate ? ` (${new Date().getFullYear() - birth.getFullYear()} anos)` : '';
    drawField('NASCIMENTO:', (student.birthDate ? birth.toLocaleDateString('pt-BR') : '---') + ageStr, 20, currentY, 35);
    currentY += 7;
    
    drawField('TELEFONE:', student.phone, 20, currentY, 35);
    currentY += 7;
    drawField('E-MAIL:', student.email, 20, currentY, 35);

    // Conditional Section: Responsável
    if (student.guardianName) {
      currentY += 12;
      doc.setFontSize(10);
      doc.setTextColor(79, 70, 229);
      doc.setFont('helvetica', 'bold');
      doc.text('1.1 DADOS DO RESPONSÁVEL LEGAL', 20, currentY);
      doc.line(20, currentY + 2, 190, currentY + 2);

      currentY += 10;
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      drawField('NOME:', student.guardianName, 20, currentY, 35);
      currentY += 7;
      drawField('CPF:', student.guardianCpf, 20, currentY, 35);
    }

    // Section: Informações do Curso
    currentY += 15;
    doc.setFontSize(10);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('2. INFORMAÇÕES ACADÊMICAS E VÍNCULO', 20, currentY);
    doc.line(20, currentY + 2, 190, currentY + 2);

    currentY += 10;
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    drawField('CURSO:', course?.name || 'Não vinculado', 20, currentY, 35);
    currentY += 7;
    drawField('TURMA:', cls?.name || 'Não atribuída', 20, currentY, 35);
    currentY += 7;
    drawField('PROFESSOR:', cls?.teacher || 'N/A', 20, currentY, 35);
    currentY += 7;
    drawField('HORÁRIO:', cls?.schedule || 'N/A', 20, currentY, 35);

    // Section: Status e Registro
    currentY += 15;
    doc.setFontSize(10);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('3. REGISTRO DE MATRÍCULA', 20, currentY);
    doc.line(20, currentY + 2, 190, currentY + 2);

    currentY += 10;
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    drawField('DATA DE MATRÍCULA:', new Date(student.registrationDate).toLocaleDateString('pt-BR'), 20, currentY, 45);
    currentY += 7;
    drawField('SITUAÇÃO ATUAL:', student.status === 'active' ? 'ATIVO / REGULAR' : 'INATIVO / TRANCADO', 20, currentY, 45);

    // Footer - Signatures
    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Documento gerado eletronicamente em: ' + new Date().toLocaleString('pt-BR'), 105, pageHeight - 15, { align: 'center' });
    
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.2);
    doc.line(25, pageHeight - 45, 90, pageHeight - 45);
    doc.text(student.guardianName ? 'ASSINATURA DO RESPONSÁVEL' : 'ASSINATURA DO ALUNO', 57.5, pageHeight - 40, { align: 'center' });

    doc.line(120, pageHeight - 45, 185, pageHeight - 45);
    doc.text('COORDENAÇÃO ACADÊMICA', 152.5, pageHeight - 40, { align: 'center' });

    doc.save(`ficha_matricula_${student.name.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  },

  generateStudentHistoryPDF: async (student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = await addHeader(doc, schoolData);
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
      didDrawPage: async (data: any) => {
        if (data.pageNumber > 1) await addHeader(doc, schoolData);
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
      didDrawPage: async (data: any) => {
        if (data.pageNumber > 1) await addHeader(doc, schoolData);
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

  generatePaymentReceiptPDF: async (payment: Payment, student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, 190, 140); // Border

    const profile = schoolData.profile;
    if (profile.logo) {
       await addImageProportional(doc, profile.logo, 20, 15, 20, 20);
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

  generateContractPDF: async (contract: Contract, student: Student, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    let currentY = await addHeader(doc, schoolData);
    
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
      didDrawPage: async (data: any) => {
        if (data.pageNumber > 1) await addHeader(doc, schoolData);
      }
    });

    let finalY = (doc as any).lastAutoTable.finalY + 20;
    const pageHeight = doc.internal.pageSize.height;

    // Check if signatures fit on the current page
    if (finalY > pageHeight - 40) {
      doc.addPage();
      await addHeader(doc, schoolData);
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

  generateClassListPDF: async (cls: Class, schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = await addHeader(doc, schoolData);
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
      didDrawPage: async (data: any) => {
        if (data.pageNumber > 1) await addHeader(doc, schoolData);
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

  generateStudentListPDF: async (schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = await addHeader(doc, schoolData);

    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.text('Relatório Geral de Alunos', 105, startY + 5, { align: 'center' });

    doc.autoTable({
      startY: startY + 15,
      margin: { top: 45 },
      didDrawPage: async (data: any) => {
        if (data.pageNumber > 1) await addHeader(doc, schoolData);
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

  generateFullSchoolReportPDF: async (schoolData: SchoolData) => {
    const doc = new jsPDF() as any;
    const startY = await addHeader(doc, schoolData);
    
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
      didDrawPage: async (data: any) => {
        if (data.pageNumber > 1) await addHeader(doc, schoolData);
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