import React, { useState } from 'react';
import { SchoolData, User } from '../types';
import { useDialog } from '../DialogContext';
import { Plus, Edit2, Trash2, X, Shield, Lock, User as UserIcon, AlertTriangle } from 'lucide-react';

interface UserManagementProps {
  data: SchoolData;
  updateData: (newData: Partial<SchoolData>) => void;
}

const UserManagement: React.FC<UserManagementProps> = ({ data, updateData }) => {
  const { showAlert, showConfirm } = useDialog();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    cpf: ''
  });

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsModalOpen(false);
      setIsClosing(false);
      setEditingUser(null);
      setFormData({ name: '', password: '', cpf: '' });
    }, 400);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ name: user.name, password: user.password, cpf: user.cpf || '' });
    setIsModalOpen(true);
  };

  const handleDelete = (user: User) => {
    if (data.users.length <= 1) {
      showAlert('Atenção', '⚠️ Você não pode excluir o último usuário do sistema.', 'warning');
      return;
    }
    
    showConfirm(
      'Remover Usuário', 
      `Tem certeza que deseja remover o acesso de ${user.name}?`,
      () => {
        const updatedUsers = data.users.filter(u => u.id !== user.id);
        updateData({ users: updatedUsers });
      }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Basic validation
    if (formData.name.length < 3) {
      showAlert('Atenção', '⚠️ O nome deve ter no mínimo 3 caracteres.', 'warning');
      return;
    }
    if (formData.password.length < 3) {
      showAlert('Atenção', '⚠️ A senha deve ter no mínimo 3 caracteres.', 'warning');
      return;
    }
    if (!formData.cpf || formData.cpf.replace(/\D/g, '').length !== 11) {
      showAlert('Atenção', '⚠️ O CPF é obrigatório e deve ter 11 dígitos.', 'warning');
      return;
    }

    if (editingUser) {
      // Check if name is taken by another user
      const exists = data.users.some(u => u.name.toLowerCase() === formData.name.toLowerCase() && u.id !== editingUser.id);
      if (exists) {
        showAlert('Atenção', '⚠️ Este nome de usuário já está em uso.', 'warning');
        return;
      }

      const updatedUsers = data.users.map(u => 
        u.id === editingUser.id ? { ...u, name: formData.name, password: formData.password, cpf: formData.cpf } : u
      );
      updateData({ users: updatedUsers });
    } else {
      // Check if name is taken
      const exists = data.users.some(u => u.name.toLowerCase() === formData.name.toLowerCase());
      if (exists) {
        showAlert('Atenção', '⚠️ Este nome de usuário já está em uso.', 'warning');
        return;
      }

      const newUser: User = {
        id: crypto.randomUUID(),
        name: formData.name,
        password: formData.password,
        cpf: formData.cpf
      };
      updateData({ users: [...data.users, newUser] });
    }
    closeModal();
  };

  const inputClass = "w-full px-4 py-3 bg-white text-black border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Usuários do Sistema</h2>
          <p className="text-slate-500">Gerencie quem tem acesso administrativo ao EduManager.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg font-bold"
        >
          <Plus size={20} /> Novo Usuário
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {data.users.map(user => (
          <div key={user.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Shield size={24} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">{user.name}</h3>
                <p className="text-xs text-slate-400 font-mono">ID: {user.id.substring(0, 8)}</p>
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => handleEdit(user)} 
                className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-all"
                title="Editar Senha/Nome"
              >
                <Edit2 size={18} />
              </button>
              <button 
                onClick={() => handleDelete(user)} 
                className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-all"
                title="Remover Acesso"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* CREATE/EDIT MODAL */}
      {isModalOpen && (
        <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto transition-opacity duration-400 ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'}`}>
          <div className={`bg-white rounded-xl w-full max-w-md shadow-2xl my-auto transition-all duration-400 relative overflow-hidden ${isClosing ? 'animate-slide-down-fade-out' : 'animate-slide-up'}`}>
            {/* Blue Top Bar */}
            <div className="bg-indigo-600 h-1.5 w-full absolute top-0 left-0 z-10"></div>
            
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50/30">
              <div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight">
                  {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
                </h3>
                <p className="text-xs text-slate-500">Defina as credenciais de acesso.</p>
              </div>
              <button onClick={closeModal} className="p-2 bg-white text-slate-400 hover:text-red-500 rounded-lg shadow-sm transition-all hover:rotate-90">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Nome de Usuário</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    required 
                    className={`${inputClass} pl-10`}
                    placeholder="Ex: admin"
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">CPF do Usuário</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    required 
                    className={`${inputClass} pl-10`}
                    placeholder="000.000.000-00"
                    value={formData.cpf} 
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})/, '$1-$2').slice(0, 14);
                      setFormData({...formData, cpf: val});
                    }} 
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Senha de Acesso</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="text" // Visible for admin to edit easily, or password if preferred. 
                    required 
                    className={`${inputClass} pl-10`}
                    placeholder="Defina a senha"
                    value={formData.password} 
                    onChange={e => setFormData({...formData, password: e.target.value})} 
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 ml-1">Mínimo de 3 caracteres.</p>
              </div>
              
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={closeModal} className="flex-1 py-3 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-bold text-sm">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-lg font-bold text-sm">
                  Salvar Usuário
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;