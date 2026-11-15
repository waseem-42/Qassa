// Home-page folders: a big project (a series, a client, a campaign) holding smaller projects, with its own notes
// and shared files. Server: packages/server/src/folders.ts. Projects never move on disk; a folder lists their names.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { addToFolder, removeFromFolders, useStore, type ProjectFolder, type ProjectSummary } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { Icon, Spinner } from './Brand.tsx';
import { Modal } from './Modal.tsx';

const titleOf = (p: { name: string; displayName?: string }) => p.displayName || p.name;
/** drag type for moving a project card onto a folder card */
export const PROJECT_DRAG = 'application/x-qassa-project';

/**
 * The folder open on the home page — kept while a project is open, so «back home» returns into it, and in the
 * address (?folder=) so a refresh stays inside it.
 */
const folderInUrl = () => { try { return new URL(location.href).searchParams.get('folder') ?? undefined; } catch { return undefined; } };
export const useHomeFolder = create<{ id?: string; open(id?: string): void }>((set) => ({
  id: folderInUrl(),
  open: (id) => {
    set({ id });
    try { const url = new URL(location.href); if (id) url.searchParams.set('folder', id); else url.searchParams.delete('folder'); history.replaceState(history.state, '', url); } catch { /* no address bar */ }
  },
}));

const sizeLabel = (n: number) => n < 1024 ? `${n} بايت` : n < 1048576 ? `${(n / 1024).toFixed(0)} ك.ب` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} م.ب` : `${(n / 1073741824).toFixed(2)} ج.ب`;
const fileUrl = (f: ProjectFolder, name: string, download = false) => `/api/folders/${f.id}/files/${encodeURIComponent(name)}${download ? '?download=1' : ''}`;
const fileIcon = (name: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(name) ? 'image' : /\.(mp4|mov|webm|mkv)$/i.test(name) ? 'film' : /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(name) ? 'speaker' : 'text';

/** A folder on the home page: up to four project covers, its name and what is inside. Drop a project card on it to move it in. */
export function FolderCard({ folder, projects }: { folder: ProjectFolder; projects: ProjectSummary[] }) {
  const [over, setOver] = useState(false);
  const inside = folder.projects.map((n) => projects.find((p) => p.name === n)).filter((p): p is ProjectSummary => !!p);
  const covers = [...inside].sort((a, b) => b.modified - a.modified).slice(0, 4);
  return (
    <article className="folder-card" data-over={over || undefined}
      onDragOver={(e) => { if (!e.dataTransfer.types.includes(PROJECT_DRAG)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const name = e.dataTransfer.getData(PROJECT_DRAG);
        if (!name) return;
        e.preventDefault(); e.stopPropagation(); setOver(false);
        addToFolder(folder.id, [name]).then(() => useStore.getState().notify(`نُقل المشروع إلى «${folder.name}».`, 'info')).catch((err: Error) => useStore.getState().notify(err.message));
      }}>
      <button type="button" className="folder-card-open" onClick={() => useHomeFolder.getState().open(folder.id)} aria-label={`فتح مجلد ${folder.name}`}>
        <div className="folder-card-covers" data-count={covers.length}>
          {covers.length ? covers.map((p) => <FolderThumb key={p.name} project={p} />) : <span className="folder-card-empty"><Icon name="folder" size={30} /></span>}
        </div>
        <div className="folder-card-body">
          <h3 dir="auto" title={folder.name}><Icon name="folder" size={16} />{folder.name}</h3>
          <div className="project-meta"><span>{inside.length ? `${inside.length} مشروع` : 'فارغ'}</span>{!!folder.files.length && <span><Icon name="text" />{folder.files.length} ملف</span>}{!!folder.notes.trim() && <span title="فيه ملاحظات"><Icon name="edit" />ملاحظات</span>}</div>
        </div>
      </button>
    </article>
  );
}

function FolderThumb({ project }: { project: ProjectSummary }) {
  const [ok, setOk] = useState(!!project.media && (project.duration ?? 0) > 0);
  return <span className="folder-thumb">{ok ? <img src={`${projectPath(project.name)}/cover.jpg?v=${Math.round(project.modified)}`} alt="" loading="lazy" onError={() => setOk(false)} /> : <b dir="auto">{[...titleOf(project).trim()][0] ?? ''}</b>}</span>;
}

/**
 * The open folder: its name, the notes for the whole project (brief, script, ideas — Claude reads them in
 * project_summary for every project inside) and the shared files. The projects grid itself stays in Home.
 */
export function FolderHeader({ folder, onNewProject, busy }: { folder: ProjectFolder; onNewProject(): void; busy: boolean }) {
  const connected = useStore((s) => s.connection === 'connected');
  const projects = useStore((s) => s.projects);
  const [dialog, setDialog] = useState<'rename' | 'delete' | 'add'>();
  return (
    <section className="folder-header" aria-labelledby="folder-title">
      <nav className="folder-crumbs" aria-label="المسار"><button className="btn btn-ghost" onClick={() => useHomeFolder.getState().open()}><Icon name="folder" size={16} />كل المشاريع</button><span aria-hidden="true">‹</span><strong id="folder-title" dir="auto">{folder.name}</strong></nav>
      <div className="folder-actions">
        <button className="btn btn-primary" disabled={busy || !connected} onClick={onNewProject}><Icon name="plus" size={16} />مشروع جديد هنا</button>
        <button className="btn" disabled={busy || !connected || !projects.some((p) => !folder.projects.includes(p.name))} onClick={() => setDialog('add')}><Icon name="folder" size={16} />أضف مشاريع موجودة</button>
        <button className="btn btn-ghost" disabled={!connected} onClick={() => setDialog('rename')}><Icon name="edit" />إعادة تسمية</button>
        <button className="icon-button project-delete" title="حذف المجلد" aria-label={`حذف مجلد ${folder.name}`} disabled={!connected} onClick={() => setDialog('delete')}><Icon name="trash" size={16} /></button>
      </div>
      <div className="folder-panels">
        <FolderNotes folder={folder} />
        <FolderFiles folder={folder} />
      </div>
      {dialog === 'rename' && <FolderNameDialog folder={folder} onClose={() => setDialog(undefined)} />}
      {dialog === 'delete' && <DeleteFolder folder={folder} onClose={() => setDialog(undefined)} />}
      {dialog === 'add' && <AddProjects folder={folder} onClose={() => setDialog(undefined)} />}
    </section>
  );
}

/** Notes for the whole folder; saved by themselves a moment after typing stops (and on leaving the field). */
function FolderNotes({ folder }: { folder: ProjectFolder }) {
  const [text, setText] = useState(folder.notes);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const timer = useRef<number>();
  const latest = useRef(text);
  // another window (or Claude) changed them while this one is clean
  useEffect(() => { if (state === 'saved' && folder.notes !== latest.current) { setText(folder.notes); latest.current = folder.notes; } }, [folder.notes]);
  const save = async () => {
    window.clearTimeout(timer.current);
    if (latest.current === folder.notes) { setState('saved'); return; }
    setState('saving');
    try { await api.patch(`/api/folders/${folder.id}`, { notes: latest.current }); setState('saved'); useStore.getState().loadProjects().catch(() => {}); }
    catch { setState('error'); }
  };
  useEffect(() => () => { window.clearTimeout(timer.current); if (latest.current !== folder.notes) void api.patch(`/api/folders/${folder.id}`, { notes: latest.current }).catch(() => {}); }, [folder.id]);
  return (
    <div className="folder-panel">
      <div className="folder-panel-head"><h3><Icon name="edit" size={16} />ملاحظات المشروع</h3><span className="folder-save" data-state={state} role="status">{state === 'saving' ? 'جارٍ الحفظ…' : state === 'dirty' ? 'لم يُحفظ بعد' : state === 'error' ? 'تعذّر الحفظ' : 'محفوظ'}</span></div>
      <textarea className="field folder-notes" dir="auto" value={text} maxLength={100000}
        placeholder="كل شيء عن المشروع: الفكرة، الجمهور، السكربت، المواعيد، الأسلوب… يقرأها Claude لما يمنتج أي مشروع داخل هذا المجلد."
        onChange={(e) => { setText(e.target.value); latest.current = e.target.value; setState('dirty'); window.clearTimeout(timer.current); timer.current = window.setTimeout(save, 900); }}
        onBlur={save} />
    </div>
  );
}

/** Files that belong to the whole project: script, references, logo, documents. Drop them here or pick them. */
function FolderFiles({ folder }: { folder: ProjectFolder }) {
  const [uploading, setUploading] = useState(0), [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(files.length);
    try { await api.upload(`/api/folders/${folder.id}/files`, files); await useStore.getState().loadProjects(); }
    catch (e) { useStore.getState().notify(`تعذّر رفع الملفات: ${(e as Error).message}`); }
    finally { setUploading(0); }
  };
  const remove = async (name: string) => {
    try { await api.delete(`/api/folders/${folder.id}/files/${encodeURIComponent(name)}`); await useStore.getState().loadProjects(); }
    catch (e) { useStore.getState().notify((e as Error).message); }
  };
  return (
    <div className="folder-panel" data-over={over || undefined}
      onDragOver={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.stopPropagation(); setOver(false); void upload([...e.dataTransfer.files]); }}>
      <div className="folder-panel-head"><h3><Icon name="folder" size={16} />ملفات المشروع<span className="count-badge">{folder.files.length}</span></h3>
        <button className="btn btn-ghost" disabled={!!uploading} onClick={() => pick.current?.click()}>{uploading ? <Spinner size={14} /> : <Icon name="upload" />}{uploading ? `جارٍ رفع ${uploading}…` : 'أضف ملفات'}</button>
        <input ref={pick} type="file" hidden multiple onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} /></div>
      {folder.files.length ? <ul className="folder-files">{folder.files.map((f) => (
        <li key={f.name}>
          <Icon name={fileIcon(f.name)} size={16} />
          <a href={fileUrl(folder, f.name)} target="_blank" rel="noreferrer" dir="auto" title={f.name}>{f.name}</a>
          <span className="num">{sizeLabel(f.size)}</span>
          <a className="icon-button" href={fileUrl(folder, f.name, true)} download aria-label={`تنزيل ${f.name}`} title="تنزيل"><Icon name="download" size={15} /></a>
          <button className="icon-button project-delete" aria-label={`حذف ${f.name}`} title="حذف الملف" onClick={() => { if (window.confirm(`حذف «${f.name}» من ملفات المجلد نهائيًا؟`)) void remove(f.name); }}><Icon name="trash" size={15} /></button>
        </li>))}</ul>
        : <p className="folder-files-empty">أفلت هنا السكربت، الرفرنسات، الشعار، أو أي مستند يخص المشروع كله.</p>}
    </div>
  );
}

/** New folder (no folder given) or a new name for one. */
export function FolderNameDialog({ folder, projects = [], onClose }: { folder?: ProjectFolder; projects?: string[]; onClose(): void }) {
  const folders = useStore((s) => s.folders);
  const [name, setName] = useState(folder?.name ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = name.trim().replace(/\s+/g, ' ');
    if (!title || busy) return;
    if (folders.some((f) => f.id !== folder?.id && f.name.toLocaleLowerCase() === title.toLocaleLowerCase())) { setError('يوجد مجلد بهذا الاسم.'); return; }
    setBusy(true); setError('');
    try {
      const made = folder ? await api.patch<ProjectFolder>(`/api/folders/${folder.id}`, { name: title }) : await api.post<ProjectFolder>('/api/folders', { name: title, projects });
      await useStore.getState().loadProjects();
      // a new empty folder opens (once the list has it); one made for a project stays where you are
      if (!folder && !projects.length) useHomeFolder.getState().open(made.id);
      onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title={folder ? 'اسم جديد للمجلد' : 'مجلد مشروع جديد'} subtitle={folder ? undefined : 'مجلد لمشروع كبير — سلسلة، عميل، حملة — يجمع مشاريعه الصغيرة وملاحظاته وملفاته.'} initialFocus="#folder-name" onClose={() => { if (!busy) onClose(); }}>
    <form className="modal-body project-dialog-form" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="folder-name">اسم المجلد</label>
      <input id="folder-name" className="field" dir="auto" value={name} maxLength={120} required disabled={busy} placeholder="مثلاً: سلسلة يارا" onFocus={(e) => e.target.select()} onChange={(e) => { setName(e.target.value); setError(''); }} aria-invalid={!!error} />
      {error && <p className="home-inline-error" role="alert">{error}</p>}
      <div className="project-dialog-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>إلغاء</button><button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? <Spinner size={16} /> : <Icon name={folder ? 'edit' : 'plus'} />}{folder ? 'حفظ الاسم' : 'إنشاء المجلد'}</button></div>
    </form>
  </Modal>;
}

function DeleteFolder({ folder, onClose }: { folder: ProjectFolder; onClose(): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const remove = async () => {
    setBusy(true); setError('');
    try { await api.delete(`/api/folders/${folder.id}`); useHomeFolder.getState().open(); await useStore.getState().loadProjects(); onClose(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return <Modal title="حذف المجلد؟" subtitle="المشاريع التي فيه لا تُحذف: ترجع إلى «كل المشاريع»." initialFocus="[data-cancel-folder]" onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body project-dialog-form">
      <p>يُحذف مجلد «{folder.name}» مع ملاحظاته{folder.files.length ? ` و${folder.files.length} ملف مشترك فيه نهائيًا` : ''}. لا يمكن التراجع.</p>
      {error && <p className="home-inline-error" role="alert">{error}</p>}
      <div className="project-dialog-actions"><button className="btn" data-cancel-folder disabled={busy} onClick={onClose}>إلغاء</button><button className="btn btn-danger" disabled={busy} onClick={remove}>{busy ? 'جارٍ الحذف…' : 'حذف المجلد'}</button></div>
    </div>
  </Modal>;
}

/** Pick existing projects to put in this folder. */
function AddProjects({ folder, onClose }: { folder: ProjectFolder; onClose(): void }) {
  const projects = useStore((s) => s.projects), folders = useStore((s) => s.folders);
  const [picked, setPicked] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const outside = projects.filter((p) => !folder.projects.includes(p.name)).sort((a, b) => b.modified - a.modified);
  const where = (name: string) => folders.find((f) => f.projects.includes(name))?.name;
  const add = async () => {
    setBusy(true);
    try { await addToFolder(folder.id, picked); onClose(); }
    catch (e) { useStore.getState().notify((e as Error).message); setBusy(false); }
  };
  return <Modal title={`أضف مشاريع إلى «${folder.name}»`} subtitle="المشروع يكون في مجلد واحد: لو كان في مجلد ثاني ينتقل إلى هذا." onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body project-dialog-form">
      <ul className="folder-pick">{outside.map((p) => <li key={p.name}><label><input type="checkbox" checked={picked.includes(p.name)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.name] : picked.filter((x) => x !== p.name))} /><span dir="auto">{titleOf(p)}</span>{where(p.name) && <small dir="auto">في «{where(p.name)}»</small>}</label></li>)}</ul>
      <div className="project-dialog-actions"><button className="btn" disabled={busy} onClick={onClose}>إلغاء</button><button className="btn btn-primary" disabled={busy || !picked.length} onClick={add}>{busy ? <Spinner size={16} /> : <Icon name="plus" />}أضف {picked.length || ''}</button></div>
    </div>
  </Modal>;
}

/** «نقل إلى مجلد» on a project card: pick a folder, a new one, or none. */
export function MoveToFolder({ project, onClose }: { project: ProjectSummary; onClose(): void }) {
  const folders = useStore((s) => s.folders);
  const current = folders.find((f) => f.projects.includes(project.name));
  const [busy, setBusy] = useState(false), [making, setMaking] = useState(false);
  const move = async (id?: string) => {
    setBusy(true);
    try {
      if (id) await addToFolder(id, [project.name]); else await removeFromFolders([project.name]);
      useStore.getState().notify(id ? `نُقل «${titleOf(project)}» إلى «${folders.find((f) => f.id === id)?.name}».` : `أُخرج «${titleOf(project)}» من المجلد.`, 'info');
      onClose();
    } catch (e) { useStore.getState().notify((e as Error).message); setBusy(false); }
  };
  if (making) return <FolderNameDialog projects={[project.name]} onClose={onClose} />;
  return <Modal title="نقل إلى مجلد" subtitle={titleOf(project)} onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body project-dialog-form">
      <ul className="folder-pick">
        {folders.map((f) => <li key={f.id}><button className="btn btn-ghost" disabled={busy || f.id === current?.id} aria-current={f.id === current?.id || undefined} onClick={() => move(f.id)}><Icon name="folder" size={16} /><span dir="auto">{f.name}</span>{f.id === current?.id && <small>هنا الآن</small>}</button></li>)}
        <li><button className="btn btn-ghost" disabled={busy} onClick={() => setMaking(true)}><Icon name="plus" size={16} />مجلد جديد…</button></li>
        {current && <li><button className="btn btn-ghost" disabled={busy} onClick={() => move()}><Icon name="close" size={16} />أخرجه من المجلد</button></li>}
      </ul>
    </div>
  </Modal>;
}
