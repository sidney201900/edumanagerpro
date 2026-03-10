import React, { useState, useMemo } from 'react';
import { SchoolData, SchoolProfile } from '../types';
import { dbService } from '../services/dbService';
import { Download, Upload, Trash2, Database, School, Camera, FileText, Info, AlertTriangle, X, CheckCircle, AlertCircle, Cloud, HelpCircle, RefreshCw } from 'lucide-react';
import { isSupabaseConfigured } from '../services/supabase';
import { useDialog } from '../DialogContext';

import { compressImage } from '../services/imageService';

interface SettingsProps {
  data: SchoolData;
  updateData: (newData: Partial<SchoolData>) => void;
  setData: (data: SchoolData) => void;
}

const Settings: React.FC<SettingsProps> = ({ data, updateData, setData }) => {
  const { showAlert, showConfirm } = useDialog();
  const [profile, setProfile] = useState<SchoolProfile>({
    name: data.profile.name || '',
    address: data.profile.address || '',
    cnpj: data.profile.cnpj || '',
    phone: data.profile.phone || '',
    email: data.profile.email || '',
    contractTemplate: data.profile.contractTemplate || '',
    logo: data.profile.logo || ''
  });
  const [isSyncing, setIsSyncing] = useState(false);
  
  const supabaseConfigured = useMemo(() => isSupabaseConfigured(), []);
  
  // Custom modal states
  const [showImportModal, setShowImportModal] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const saveProfile = () => {
    updateData({ profile });
    showAlert('Sucesso', 'Configurações salvas com sucesso!', 'success');
  };

  const downloadSupabaseSQL = () => {
    const sql = `-- Create the table for storing the entire application state as a JSON blob
create table if not exists school_data (
  id bigint primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Insert the initial row (id=1) if it doesn't exist so the app has something to fetch/update
insert into school_data (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- Enable Row Level Security (RLS)
alter table school_data enable row level security;

-- Create a policy that allows anyone to read/write (for development/demo purposes)
-- In a real production app, you would restrict this to authenticated users
create policy "Enable read access for all users"
on school_data for select
using (true);

create policy "Enable insert access for all users"
on school_data for insert
with check (true);

create policy "Enable update access for all users"
on school_data for update
using (true);`;

    const blob = new Blob([sql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'supabase_setup.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  const closeModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      setShowImportModal(false);
      setIsClosing(false);
    }, 300);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setProfile(prev => ({ ...prev, logo: compressed }));
      } catch (error) {
        console.error('Erro ao comprimir imagem:', error);
        showAlert('Erro', 'Falha ao processar imagem.', 'error');
      }
    }
  };

  const handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  const formatPhone = (value: string) => {
    return value
      .replace(/\D/g, '')
      .replace(/^(\d{2})(\d)/, '($1) $2 ')
      .replace(/(\d{4})(\d)/, '$1-$2')
      .slice(0, 16);
  };

  const handleManualSync = async () => {
    if (!supabaseConfigured) return;
    
    setIsSyncing(true);
    try {
      const cloudData = await dbService.fetchFromCloud();
      if (cloudData) {
        setData(cloudData);
        await dbService.saveData(cloudData);
        showAlert('Sucesso', '✅ Dados sincronizados com a nuvem!', 'success');
      } else {
        // If no cloud data, maybe we should push local data?
        await dbService.saveToCloud(data);
        showAlert('Sucesso', '✅ Dados locais enviados para a nuvem!', 'success');
      }
    } catch (error) {
      showAlert('Erro', '❌ Falha na sincronização. Verifique sua conexão e configurações.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const inputClass = "w-full px-4 py-3 bg-white text-black border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm text-sm";

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-20">
      <header>
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Configurações</h2>
        <p className="text-slate-500 font-medium">Gerencie o perfil da escola, modelo de contrato e dados.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center gap-3 text-indigo-600">
              <div className="p-3 bg-indigo-50 rounded-lg">
                <School size={24} />
              </div>
              <h3 className="text-xl font-black text-slate-800">Perfil da Instituição</h3>
            </div>

            <div className="flex flex-col md:flex-row gap-8">
              <div className="flex flex-col items-center gap-4">
                <div className="w-40 h-40 rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden relative group shadow-inner">
                  {profile.logo ? (
                    <img src={profile.logo} alt="Logo" className="w-full h-full object-contain p-2" />
                  ) : (
                    <div className="text-slate-300 text-center p-4">
                      <Camera size={40} className="mx-auto mb-2 opacity-20" />
                      <span className="text-[10px] font-bold uppercase text-slate-500">Logo da Escola</span>
                    </div>
                  )}
                  <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer text-white">
                    <Upload size={24} />
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                </div>
              </div>

              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Nome da Escola</label>
                    <input className={inputClass} value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">CNPJ</label>
                    <input className={inputClass} placeholder="00.000.000/0001-00" value={profile.cnpj} onChange={e => setProfile({...profile, cnpj: e.target.value})} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Endereço Completo</label>
                  <input className={inputClass} value={profile.address} onChange={e => setProfile({...profile, address: e.target.value})} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Telefone</label>
                    <input className={inputClass} placeholder="(00) 0 0000-0000" value={profile.phone} onChange={e => setProfile({...profile, phone: formatPhone(e.target.value)})} maxLength={16} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Email</label>
                    <input className={inputClass} placeholder="Email" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center gap-3 text-indigo-600">
              <div className="p-3 bg-indigo-50 rounded-lg">
                <FileText size={24} />
              </div>
              <h3 className="text-xl font-black text-slate-800">Modelo Global de Contrato</h3>
            </div>
            
            <div className="bg-amber-50 border border-amber-100 p-4 rounded-lg flex gap-3">
              <Info className="text-amber-500 shrink-0" size={20} />
              <div className="text-xs text-amber-800 space-y-2">
                <p className="font-bold">Dica de Placeholders (Tags que serão substituídas automaticamente):</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <p className="font-bold text-[10px] uppercase text-amber-900/60 mb-1">Aluno</p>
                    <p><code className="bg-white px-1 rounded">{"{{aluno}}"}</code>, <code className="bg-white px-1 rounded">{"{{aluno_cpf}}"}</code>, <code className="bg-white px-1 rounded">{"{{aluno_rg}}"}</code></p>
                    <p><code className="bg-white px-1 rounded">{"{{aluno_nascimento}}"}</code>, <code className="bg-white px-1 rounded">{"{{aluno_email}}"}</code></p>
                    <p><code className="bg-white px-1 rounded">{"{{aluno_telefone}}"}</code>, <code className="bg-white px-1 rounded">{"{{aluno_cep}}"}</code></p>
                    <p><code className="bg-white px-1 rounded">{"{{aluno_endereco}}"}</code>, <code className="bg-white px-1 rounded">{"{{aluno_bairro}}"}</code></p>
                    <p><code className="bg-white px-1 rounded">{"{{aluno_cidade}}"}</code>, <code className="bg-white px-1 rounded">{"{{aluno_estado}}"}</code></p>
                  </div>
                  <div>
                    <p className="font-bold text-[10px] uppercase text-amber-900/60 mb-1">Responsável</p>
                    <p><code className="bg-white px-1 rounded">{"{{responsavel_nome}}"}</code>, <code className="bg-white px-1 rounded">{"{{responsavel_cpf}}"}</code></p>
                    <p><code className="bg-white px-1 rounded">{"{{responsavel_nascimento}}"}</code></p>
                    
                    <p className="font-bold text-[10px] uppercase text-amber-900/60 mt-2 mb-1">Curso e Turma</p>
                    <p><code className="bg-white px-1 rounded">{"{{curso}}"}</code>, <code className="bg-white px-1 rounded">{"{{mensalidade}}"}</code>, <code className="bg-white px-1 rounded">{"{{duracao}}"}</code></p>
                    <p><code className="bg-white px-1 rounded">{"{{curso_taxa_matricula}}"}</code>, <code className="bg-white px-1 rounded">{"{{turma_nome}}"}</code></p>
                    <p><code className="bg-white px-1 rounded">{"{{turma_professor}}"}</code>, <code className="bg-white px-1 rounded">{"{{turma_horario}}"}</code></p>
                    
                    <p className="font-bold text-[10px] uppercase text-amber-900/60 mt-2 mb-1">Escola</p>
                    <p><code className="bg-white px-1 rounded">{"{{escola}}"}</code>, <code className="bg-white px-1 rounded">{"{{cnpj_escola}}"}</code>, <code className="bg-white px-1 rounded">{"{{data}}"}</code></p>
                  </div>
                </div>
              </div>
            </div>

            <textarea 
              className={`${inputClass} h-64 font-serif leading-relaxed resize-none p-6 bg-white text-black`}
              value={profile.contractTemplate}
              onChange={e => setProfile({...profile, contractTemplate: e.target.value})}
              placeholder="Digite o texto base das cláusulas do contrato..."
            />
            
            <button 
              onClick={saveProfile}
              className="w-full py-4 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-lg font-bold text-sm"
            >
              Salvar Todas as Configurações
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-indigo-600">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <Cloud size={20} />
              </div>
              <h3 className="text-lg font-black text-slate-800">Sincronização Nuvem</h3>
            </div>
            
            <div className={`p-4 rounded-lg border ${supabaseConfigured ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
              <div className="flex items-center gap-2 font-bold text-sm mb-1">
                {supabaseConfigured ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {supabaseConfigured ? 'Conectado ao Supabase' : 'Não Conectado'}
              </div>
              <p className="text-xs opacity-80 leading-relaxed">
                {supabaseConfigured 
                  ? 'Seus dados estão sendo salvos automaticamente na nuvem.' 
                  : 'Para habilitar o backup na nuvem, configure as variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_KEY.'}
              </p>
              {!supabaseConfigured && (
                <div className="mt-3 text-[10px] bg-white p-2 rounded border border-slate-200 font-mono text-slate-400 break-all">
                  VITE_SUPABASE_URL=...<br/>
                  VITE_SUPABASE_KEY=...
                </div>
              )}
            </div>

            {supabaseConfigured && (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700">
                <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                  <CheckCircle size={14} /> Sincronização Automática Ativa
                </p>
              </div>
            )}

            <button 
              onClick={downloadSupabaseSQL}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-all font-bold text-xs border border-indigo-100"
            >
              <FileText size={16} /> Baixar Script SQL Supabase
            </button>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-indigo-600">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <Database size={20} />
              </div>
              <h3 className="text-lg font-black text-slate-800">Dados do System</h3>
            </div>
            <button onClick={async () => await dbService.exportData()} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-all font-bold text-xs">
              <Download size={16} /> Exportar Backup
            </button>
            <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 text-slate-600 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors font-bold text-xs">
              <Upload size={16} /> Importar Backup
              <input type="file" className="hidden" accept=".json" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  showConfirm(
                    'Substituir Dados?', 
                    '⚠️ Tem certeza que deseja substituir todos os dados atuais? Esta ação não pode ser desfeita.',
                    async () => {
                      await dbService.importData(file);
                      const newData = await dbService.initData();
                      setData(newData);
                      showAlert('Sucesso', '✅ Dados restaurados com sucesso!', 'success');
                    }
                  );
                }
              }} />
            </label>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xl">
            <button 
              onClick={() => showConfirm(
                'Resetar Sistema', 
                'Isso apagará TODOS os dados cadastrados. Não há como desfazer.',
                handleReset,
                'alert'
              )} 
              className="w-full py-3 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-bold text-xs flex items-center justify-center gap-2"
            >
              <Trash2 size={16} /> Resetar Fábrica
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;