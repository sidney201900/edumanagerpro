import React from 'react';
import { SchoolData } from '../types';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { Users, BookOpen, Wallet, Clock, FileDown } from 'lucide-react';
import { pdfService } from '../services/pdfService';

interface DashboardProps {
  data: SchoolData;
}

const Dashboard: React.FC<DashboardProps> = ({ data }) => {
  const activeStudents = data.students.filter(s => s.status === 'active').length;
  const totalClasses = data.classes.length;
  const pendingPayments = data.payments.filter(p => p.status === 'pending').length;
  const revenue = data.payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);

  const stats = [
    { label: 'Alunos Ativos', value: activeStudents, icon: Users, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'Turmas', value: totalClasses, icon: BookOpen, color: 'text-indigo-600', bg: 'bg-indigo-100' },
    { label: 'Mensalidades Pendentes', value: pendingPayments, icon: Clock, color: 'text-orange-600', bg: 'bg-orange-100' },
    { label: 'Receita Total', value: `R$ ${revenue.toLocaleString()}`, icon: Wallet, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  ];

  // Dummy data for charts based on existing state
  const classOccupancy = data.classes.map(c => ({
    name: c.name,
    students: data.students.filter(s => s.classId === c.id).length
  }));

  const paymentStatus = [
    { name: 'Pago', value: data.payments.filter(p => p.status === 'paid').length },
    { name: 'Pendente', value: data.payments.filter(p => p.status === 'pending').length },
    { name: 'Atrasado', value: data.payments.filter(p => p.status === 'overdue').length },
  ];

  const COLORS = ['#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Painel de Controle</h2>
          <p className="text-slate-500">Bem-vindo ao sistema de gestão EduManager.</p>
        </div>
        <button 
          onClick={() => pdfService.generateFullSchoolReportPDF(data)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors shadow-sm"
        >
          <FileDown size={20} />
          Relatório Completo (PDF)
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className={`${stat.bg} ${stat.color} p-3 rounded-lg`}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
              <h3 className="text-xl font-bold text-slate-900">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Ocupação por Turma</h3>
          <div className="h-64">
            {classOccupancy.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={classOccupancy}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="students" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">Nenhuma turma cadastrada</div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Status Financeiro</h3>
          <div className="h-64 flex flex-col items-center">
            {data.payments.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {paymentStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">Nenhum pagamento registrado</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;