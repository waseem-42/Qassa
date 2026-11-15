import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fmtTime, TRASH_RETENTION_DAYS, type ProjectStart } from '@edit/shared';
import { StartChoice } from './StartChoice.tsx';
import { useStore, type Job, type ProjectSummary, type TrashedProject } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { projectName } from '../lib/project-name.ts';

/** frames in the hover strip (the server's STRIP_FRAMES) */
const STRIP_FRAMES = 10;
const TINTS = ['--color-accent', '--color-note', '--color-clip-video', '--color-clip-overlay', '--color-clip-text', '--color-clip-audio'];
import { Icon, Spinner } from './Brand.tsx';
import { Modal } from './Modal.tsx';
import { FolderCard, FolderHeader, FolderNameDialog, MoveToFolder, PROJECT_DRAG, useHomeFolder } from './HomeFolders.tsx';
import { addToFolder } from '../lib/store.ts';

const titleOf = (p: { name: string; displayName?: string }) => p.displayName || p.name;
const dateLabel = (date: string | number) => new Date(date).toLocaleDateString('ar-SA', { calendar: 'gregory', day: 'numeric', month: 'short', year: 'numeric' });
const matches = (p: { name: string; displayName?: string }, query: string) => `${titleOf(p)} ${p.name}`.normalize('NFKC').toLocaleLowerCase('ar').includes(query.trim().normalize('NFKC').toLocaleLowerCase('ar'));
const relative = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]] as const;
/** «قبل ٥ دقائق»: when you last touched it says more than a date */
const ago = (ms: number) => {
  const s = (ms - Date.now()) / 1000;
  for (const [unit, n] of UNITS) if (Math.abs(s) >= n) return relative.format(Math.round(s / n), unit);
  return 'الآن';
};
// some containers (mkv) come with an empty MIME type
const isMedia = (f: File) => /^(video|audio)\//.test(f.type) || /\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|aac|flac|ogg)$/i.test(f.name);
export function Home() {
  const projects = useStore((s) => s.projects), trash = useStore((s) => s.trash), connection = useStore((s) => s.connection);
  const loaded = useStore((s) => s.projectsLoaded), loadError = useStore((s) => s.projectsError);
  const folders = useStore((s) => s.folders), folderId = useHomeFolder((s) => s.id);
  const folder = folders.find((f) => f.id === folderId);
  const [moving, setMoving] = useState<ProjectSummary>(), [newFolder, setNewFolder] = useState(false);
  // a folder deleted elsewhere: back to the top
  useEffect(() => { if (folderId && loaded && !folder) useHomeFolder.getState().open(); }, [folderId, loaded, folder]);
  const inFolder = new Set(folders.flatMap((f) => f.projects));
  const folderOf = (name: string) => folders.find((f) => f.projects.includes(name));
  const [newName, setNewName] = useState(''), [query, setQuery] = useState(''), [sort, setSort] = useState('recent');
  const [start, setStart] = useState<ProjectStart>('video');
  const [view, setView] = useState<'grid' | 'list'>('grid'), [section, setSection] = useState<'projects' | 'trash'>('projects');
  const [creating, setCreating] = useState(false), [opening, setOpening] = useState(''), [restoring, setRestoring] = useState('');
  const [createError, setCreateError] = useState(''), [trashError, setTrashError] = useState(''), [trashLoaded, setTrashLoaded] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete'; project: ProjectSummary }>();
  const [permanent, setPermanent] = useState<TrashedProject | 'all'>();
  const [deleted, setDeleted] = useState<TrashedProject>();
  const [showCreate, setShowCreate] = useState(false), [dragging, setDragging] = useState(false), [importing, setImporting] = useState<{ name: string; files: number }>();
  const newInput = useRef<HTMLInputElement>(null), libraryHeading = useRef<HTMLHeadingElement>(null);
  const connected = connection === 'connected', busy = creating || !!opening || !!restoring || !!importing;
  const refreshTrash = async () => {
    setTrashError('');
    try { await useStore.getState().loadTrash(); setTrashLoaded(true); }
    catch (e) { setTrashError((e as Error).message); }
  };
  useEffect(() => { if (connected) { void refreshTrash(); useStore.getState().loadActiveJobs().catch(() => {}); } }, [connected]);
  const activeJobs = useStore((s) => s.activeJobs);
  const jobsOf = (name: string) => Object.values(activeJobs).filter((j) => j.project === name);
  const filtered = projects.filter((p) => folder ? folder.projects.includes(p.name) : query.trim() ? true : !inFolder.has(p.name)).filter((p) => matches(p, query)).sort((a, b) => sort === 'name' ? titleOf(a).localeCompare(titleOf(b), 'ar') : (b.modified - a.modified) * (sort === 'oldest' ? -1 : 1));
  const shownFolders = folder ? [] : folders.filter((f) => matches({ name: f.name }, query));
  const filteredTrash = trash.filter((p) => matches(p, query)).sort((a, b) => sort === 'name' ? titleOf(a).localeCompare(titleOf(b), 'ar') : (Date.parse(b.deletedAt) - Date.parse(a.deletedAt)) * (sort === 'oldest' ? -1 : 1));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const title = newName.trim().replace(/\s+/g, ' ');
    if (!title || busy || !connected) return;
    if (projects.some((p) => titleOf(p).toLocaleLowerCase() === title.toLocaleLowerCase())) { setCreateError('يوجد مشروع بهذا الاسم. اختر اسمًا آخر أو افتح المشروع الموجود.'); return; }
    // the folder keeps only safe characters; the title stays exactly as typed
    const { name, displayName } = projectName(title, projects.map((p) => p.name));
    setCreating(true); setCreateError('');
    try { await useStore.getState().create(name, displayName, start, folder?.id); }
    catch (e) { setCreateError((e as Error).message); }
    finally { setCreating(false); }
  };
  const open = async (name: string) => {
    if (busy || !connected) return;
    setOpening(name);
    try { await useStore.getState().open(name); }
    catch (e) { useStore.getState().notify((e as Error).message); }
    finally { setOpening(''); }
  };
  const restore = async (p: TrashedProject) => {
    if (busy || !connected) return;
    setRestoring(p.id); setTrashError('');
    try {
      await useStore.getState().restoreProject(p.id);
      if (deleted?.id === p.id) setDeleted(undefined);
      useStore.getState().notify(`تمت استعادة «${titleOf(p)}» إلى مشاريعك.`, 'info');
      libraryHeading.current?.focus();
    } catch (e) { setTrashError((e as Error).message); useStore.getState().notify((e as Error).message); }
    finally { setRestoring(''); }
  };
  // with projects the library comes first; the welcome and its big form are for the first visit only
  const welcome = loaded && !projects.length;
  const recent = projects.reduce<ProjectSummary | undefined>((a, p) => !a || p.modified > a.modified ? p : a, undefined);
  const focusNew = () => {
    setShowCreate(true);
    requestAnimationFrame(() => { newInput.current?.scrollIntoView({ block: 'center' }); newInput.current?.focus({ preventScroll: true }); });
  };
  const closeCreate = () => { if (creating) return; setShowCreate(false); setNewName(''); setCreateError(''); };
  /** a video dropped on the page: a project named after it, the video as its main clip, then open it */
  const startFrom = async (list: File[]) => {
    const files = list.filter(isMedia);
    if (!files.length) { useStore.getState().notify('أفلت ملف فيديو أو صوت لبدء مشروع منه.'); return; }
    if (busy || !connected) return;
    const { name, displayName } = projectName(files[0].name.replace(/\.[^.]+$/, ''), projects.map((p) => p.name));
    setImporting({ name, files: files.length });
    try {
      await api.post('/api/projects', { name });
      if (displayName) await api.patch(projectPath(name), { name: displayName });
      if (folder) await addToFolder(folder.id, [name]).catch(() => {});
      await api.upload(`${projectPath(name)}/upload?role=source`, files);
      await useStore.getState().loadProjects();
      await useStore.getState().open(name);
    } catch (e) { useStore.getState().notify(`تعذّر بدء المشروع من الملف: ${(e as Error).message}`); }
    finally { setImporting(undefined); }
  };
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  return <main className="home-page" dir="rtl"
    onDragOver={(e) => { if (!hasFiles(e) || busy) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(false); void startFrom([...e.dataTransfer.files]); }}>
    {(dragging || importing) && <div className="home-drop" role="status" aria-live="polite">{importing
      ? <><Spinner size={34} /><strong dir="auto">جارٍ إنشاء «{importing.name}» ورفع {importing.files > 1 ? `${importing.files} ملفات` : 'الملف'}…</strong><p>يفتح المشروع أول ما يخلص الرفع، والتحليل يكمل بالخلفية.</p></>
      : <><Icon name="film" size={40} /><strong>أفلت الفيديو لبدء مشروع جديد</strong><p>يتسمّى المشروع باسم الملف، ويصير الفيديو مقطعه الرئيسي.</p></>}</div>}
    <div className="home-content">
    {!welcome && <header className="home-top">
      <div><h1 id="home-title">مشاريعك</h1><p>{!loaded ? 'جارٍ التحميل…' : `${projects.length} مشروع${recent ? ` · آخر تعديل ${ago(recent.modified)}` : ''}`}</p></div>
      {!showCreate && <div className="home-top-actions">
        <label className="btn" aria-disabled={busy || !connected} title="أو أفلت الفيديو في أي مكان بالصفحة"><Icon name="film" size={17} />ابدأ من فيديو<input type="file" hidden accept="video/*,audio/*" multiple disabled={busy || !connected} onChange={(e) => { void startFrom([...(e.target.files ?? [])]); e.target.value = ''; }} /></label>
        <button className="btn" disabled={busy || !connected} onClick={() => setNewFolder(true)} title="مجلد لمشروع كبير يجمع مشاريعه الصغيرة وملاحظاته وملفاته"><Icon name="folder" size={17} />مجلد جديد</button>
        <button className="btn btn-primary" disabled={busy || !connected} onClick={focusNew}><Icon name="plus" size={17} />مشروع جديد</button>
      </div>}
    </header>}
    {!welcome && folder && section === 'projects' && <FolderHeader folder={folder} busy={busy} onNewProject={focusNew} />}
    {!welcome && showCreate && <form className="home-create" onSubmit={create} aria-busy={creating}>
      <StartChoice value={start} onChange={setStart} disabled={creating} />
      <input ref={newInput} id="new-project-name" className="field" dir="auto" aria-label="اسم المشروع الجديد" placeholder={folder ? `مشروع جديد داخل «${folder.name}»` : 'اسم المشروع، مثلاً: شرح الإضاءة'} value={newName} onChange={(e) => { setNewName(e.target.value); setCreateError(''); }} onKeyDown={(e) => { if (e.key === 'Escape') closeCreate(); }} maxLength={80} required disabled={creating} aria-describedby={createError ? 'create-error' : undefined} aria-invalid={!!createError} />
      <button className="btn btn-primary" disabled={busy || !newName.trim() || !connected}>{creating ? <Spinner size={17} /> : <Icon name="plus" size={17} />}{creating ? 'جارٍ الإنشاء…' : 'إنشاء'}</button>
      <button type="button" className="btn btn-ghost" disabled={creating} onClick={closeCreate}>إلغاء</button>
      {createError && <p id="create-error" className="home-inline-error" role="alert">{createError}</p>}
    </form>}
    {!welcome && !folder && recent && <section className="home-resume" aria-label="واصل من حيث توقفت">
      <button className="home-resume-cover" onClick={() => open(recent.name)} disabled={busy || !connected} aria-label={`فتح مشروع ${titleOf(recent)}`}><ProjectCover project={recent} /></button>
      <div className="home-resume-body">
        <span className="eyebrow">واصل من حيث توقفت</span>
        <h2 dir="auto" title={titleOf(recent)}>{titleOf(recent)}</h2>
        <ProjectMeta project={recent} />
        <ProjectJobs jobs={jobsOf(recent.name)} />
        <time dateTime={new Date(recent.modified).toISOString()} title={dateLabel(recent.modified)}>آخر تعديل {ago(recent.modified)}</time>
        <button className="btn btn-primary" onClick={() => open(recent.name)} disabled={busy || !connected}>{opening === recent.name ? <Spinner size={17} /> : <Icon name="play" size={17} />}{opening === recent.name ? 'جارٍ الفتح…' : 'افتح المشروع'}</button>
      </div>
    </section>}
    {welcome && <section className="home-hero" aria-labelledby="home-title">
      <div className="home-intro"><span className="eyebrow text-accent">مساحة لقصتك القادمة</span><h1 id="home-title">كل قصة تبدأ بلقطة.<br /><span>والباقي، بأسلوبك.</span></h1><p>اجمع لقطاتك، رتّب تفاصيلك، واصنع مونتاجًا يشبهك. مشاريعك وأدواتك في مكان واحد.</p><div className="hero-tags"><span><Icon name="cut" />قصّ وترتيب</span><span><Icon name="text" />نصوص وعناوين</span><span><Icon name="palette" />هوية وأساليب</span></div><div className="home-timeline" aria-hidden="true"><div className="home-timeline-ruler"><span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span></div><div className="home-timeline-clips"><i /><i /><i /><i /></div><div className="home-timeline-audio" /><span className="home-timeline-head" /></div></div>
      <form className="new-project-card" onSubmit={create} aria-busy={creating}><span className="new-project-icon"><Icon name="plus" size={25} /></span><h2>ابدأ قصة جديدة</h2><p>أنشئ مشروعًا، ثم أضف مقاطعك لتبدأ.</p><StartChoice value={start} onChange={setStart} disabled={creating} /><label htmlFor="new-project-name">اسم المشروع</label><input ref={newInput} id="new-project-name" className="field" dir="auto" placeholder="مثلاً: شرح الإضاءة" value={newName} onChange={(e) => { setNewName(e.target.value); setCreateError(''); }} maxLength={80} required disabled={creating} aria-describedby={createError ? 'create-error' : 'create-hint'} aria-invalid={!!createError} />{createError && <p id="create-error" className="home-inline-error" role="alert">{createError}</p>}<button className="btn btn-primary" disabled={busy || !newName.trim() || !connected}>{creating ? <Spinner size={17} /> : <Icon name="plus" size={17} />}{creating ? 'جارٍ الإنشاء…' : 'إنشاء مشروع'}</button><small id="create-hint"><Icon name="folder" />يُحفظ المشروع وملفاته على جهازك</small><small className="home-drop-hint">أو أفلت فيديو في أي مكان بالصفحة ونبدأ منه</small></form>
    </section>}
    {!connected && <div className="home-connection notice" role="status"><Spinner size={18} /><span>{connection === 'connecting' ? 'جارٍ الاتصال بالخادم…' : 'انقطع الاتصال. نحاول الاتصال مجددًا…'} ستتاح إدارة المشاريع عند عودة الاتصال.</span></div>}
    <section className="projects-section" aria-labelledby="projects-title">
      <div className="section-heading"><h2 ref={libraryHeading} tabIndex={-1} id="projects-title">{welcome ? 'مكتبة مشاريعك' : folder && section === 'projects' ? `مشاريع «${folder.name}»` : 'كل المشاريع'}</h2></div>
      <div className="project-library-bar"><div className="project-sections" aria-label="أقسام مكتبة المشاريع"><button aria-pressed={section === 'projects'} onClick={() => setSection('projects')}><Icon name="folder" size={17} />المشاريع<span className="count-badge">{projects.length}</span></button><button aria-pressed={section === 'trash'} onClick={() => { setSection('trash'); if (connected) void refreshTrash(); }}><Icon name="trash" size={17} />المحذوفات{trashLoaded && <span className="count-badge">{trash.length}</span>}</button></div><div className="project-view-toggle" hidden={section === 'trash'} aria-label="طريقة عرض المشاريع">{(['grid', 'list'] as const).map((mode) => <button className="icon-button" key={mode} aria-label={mode === 'grid' ? 'عرض شبكي' : 'عرض قائمة'} title={mode === 'grid' ? 'عرض شبكي' : 'عرض قائمة'} aria-pressed={view === mode} onClick={() => setView(mode)}><Icon name={mode} size={17} /></button>)}</div></div>
      <div className="project-filters"><div className="search-field"><Icon name="search" size={18} /><input type="search" aria-label="البحث في المشاريع" placeholder={section === 'trash' ? 'ابحث في المحذوفات…' : 'ابحث عن مشروع…'} value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="مسح البحث" onClick={() => setQuery('')}><Icon name="close" /></button>}</div><label className="project-sort"><span>الترتيب</span><select className="field" aria-label="ترتيب المشاريع" value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option><option value="name">الاسم: أ — ي</option></select></label></div>
      {deleted && trash.some((p) => p.id === deleted.id) && <div className="project-undo" role="status"><Icon name="trash" size={18} /><span>نُقل «{titleOf(deleted)}» إلى المحذوفات.</span><button className="btn btn-ghost" disabled={busy || !connected} onClick={() => restore(deleted)}><Icon name="restore" />{restoring === deleted.id ? 'جارٍ الاستعادة…' : 'تراجع عن الحذف'}</button><button className="icon-button" aria-label="إخفاء رسالة الحذف" onClick={() => setDeleted(undefined)}><Icon name="close" /></button></div>}
      {section === 'projects' ? <>
        {loadError && <div className="home-inline-error notice" role="alert">تعذّر تحديث المشاريع: {loadError}<button className="btn" disabled={!connected} onClick={() => useStore.getState().loadProjects().catch(() => {})}>إعادة المحاولة</button></div>}
        <p className="project-result-count" role="status">{query && `${filtered.length} نتيجة من ${projects.length} مشروع`}</p>
        {!!shownFolders.length && <div className="folder-grid" aria-label="المجلدات">{shownFolders.map((f) => <FolderCard key={f.id} folder={f} projects={projects} />)}</div>}
        {!!shownFolders.length && !!filtered.length && <h3 className="folder-loose-title">{query ? 'المشاريع' : 'مشاريع بلا مجلد'}</h3>}
        <div className="project-grid" data-view={view} aria-busy={!!opening}>{filtered.map((p) => <article className="project-card" key={p.name} draggable={connected && !busy} onDragStart={(e) => { e.dataTransfer.setData(PROJECT_DRAG, p.name); e.dataTransfer.effectAllowed = 'move'; }}>
          <button className="project-card-open" onClick={() => open(p.name)} disabled={busy || !connected} aria-label={`فتح مشروع ${titleOf(p)}`}><ProjectCover project={p} /><div className="project-card-body"><h3 dir="auto" title={titleOf(p)}>{titleOf(p)}</h3><ProjectMeta project={p} /><ProjectJobs jobs={jobsOf(p.name)} /><time dateTime={new Date(p.modified).toISOString()} title={dateLabel(p.modified)}>{ago(p.modified)}{!folder && query && folderOf(p.name) && <span className="project-card-folder" dir="auto"> · <Icon name="folder" />{folderOf(p.name)!.name}</span>}</time></div><span className="project-card-arrow">{opening === p.name ? <Spinner size={18} /> : <Icon name="play" size={17} />}</span></button>
          <div className="project-card-actions"><button className="btn btn-ghost" aria-label={`إعادة تسمية ${titleOf(p)}`} disabled={busy || !connected} onClick={() => setDialog({ kind: 'rename', project: p })}><Icon name="edit" />إعادة تسمية</button><button className="btn btn-ghost" aria-label={`نقل ${titleOf(p)} إلى مجلد`} title="نقل إلى مجلد — أو اسحب البطاقة فوق المجلد" disabled={busy || !connected} onClick={() => setMoving(p)}><Icon name="folder" />مجلد</button><button className="icon-button project-delete" title="نقل إلى المحذوفات" aria-label={`حذف مشروع ${titleOf(p)}`} disabled={busy || !connected} onClick={() => setDialog({ kind: 'delete', project: p })}><Icon name="trash" size={16} /></button></div>
        </article>)}</div>
        {folder && !filtered.length && !query && <div className="empty-state home-empty"><Icon name="folder" size={34} /><strong>المجلد فاضي</strong><p>أنشئ مشروعًا هنا، أو أضف مشاريع موجودة، أو أفلت فيديو في الصفحة ليبدأ مشروع داخل المجلد.</p></div>}
        {!folder && !shownFolders.length && !filtered.length && !loadError && <div className="empty-state home-empty">{!loaded ? <Spinner size={30} /> : <Icon name={query ? 'search' : 'film'} size={34} />}<strong>{!loaded ? 'جارٍ تحميل مشاريعك' : query ? 'لا توجد مشاريع بهذا الاسم' : 'أول لقطة، أول قصة'}</strong><p>{!loaded ? 'ستظهر مشاريعك هنا عند الاتصال بالخادم.' : query ? 'جرّب كلمة أخرى أو اعرض مكتبتك كاملة.' : 'أنشئ مشروعك الأول، وأضف اللقطات التي تريد العمل عليها.'}</p>{loaded && <button className="btn" onClick={() => query ? setQuery('') : focusNew()}>{query ? 'مسح البحث' : 'سمّ مشروعك الأول'}</button>}</div>}
      </> : <>
        <p className="project-trash-hint"><Icon name="restore" size={17} />تُحذف المشاريع وملفاتها نهائيًا بعد 30 يومًا. يمكنك استعادتها قبل ذلك.</p>
        {trashError && <div className="home-inline-error notice" role="alert">تعذّرت العملية: {trashError}<button className="btn" disabled={!connected || busy} onClick={refreshTrash}>تحديث المحذوفات</button></div>}
        <button className="btn btn-ghost" disabled={!trash.length || busy || !connected} onClick={() => setPermanent('all')}><Icon name="trash" />إفراغ المحذوفات</button>
        <div className="project-trash-list">{filteredTrash.map((p) => <article className="trash-card" key={p.id}><span className="trash-card-icon"><Icon name="folder" size={24} /></span><div><h3 dir="auto">{titleOf(p)}</h3><p>حُذف في <time dateTime={p.deletedAt}>{dateLabel(p.deletedAt)}</time></p><p>يُحذف نهائياً بعد {Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - (Date.now() - Date.parse(p.deletedAt)) / 86400000))} يوم</p></div><button className="btn" onClick={() => restore(p)} disabled={busy || !connected}>{restoring === p.id ? <Spinner size={16} /> : <Icon name="restore" size={16} />}{restoring === p.id ? 'جارٍ الاستعادة…' : 'استعادة'}</button><button className="btn btn-ghost" disabled={busy || !connected} onClick={() => setPermanent(p)}>حذف نهائي</button></article>)}</div>
        {!filteredTrash.length && !trashError && <div className="empty-state home-empty">{!trashLoaded ? <Spinner size={30} /> : <Icon name={query ? 'search' : 'trash'} size={34} />}<strong>{!trashLoaded ? 'جارٍ تحميل المحذوفات' : query ? 'لا توجد نتائج في المحذوفات' : 'المحذوفات فارغة'}</strong><p>{query ? 'جرّب كلمة أخرى للعثور على المشروع.' : 'عندما تحذف مشروعًا، يمكنك استعادته من هنا مع ملفاته.'}</p>{query && <button className="btn" onClick={() => setQuery('')}>مسح البحث</button>}</div>}
      </>}
    </section><footer className="home-footer"><span>قَصّة — مساحة لأسلوبك</span><span><Icon name="folder" />ملفاتك على جهازك</span></footer>
  </div>{moving && <MoveToFolder project={moving} onClose={() => setMoving(undefined)} />}{newFolder && <FolderNameDialog onClose={() => setNewFolder(false)} />}{permanent && <PermanentDelete target={permanent} count={trash.length} onClose={() => setPermanent(undefined)} onDone={async () => { setPermanent(undefined); await refreshTrash(); }} />}{dialog && <ProjectDialog kind={dialog.kind} project={dialog.project} onClose={() => setDialog(undefined)} onDeleted={(p) => { setDeleted(p); setDialog(undefined); requestAnimationFrame(() => libraryHeading.current?.focus()); }} />}</main>;
}

function ProjectMeta({ project: p }: { project: ProjectSummary }) {
  return <div className="project-meta"><span><Icon name="film" />{p.media ? `${p.media} ملف` : 'بلا وسائط بعد'}</span>{p.duration !== undefined && p.duration > 0 && <span className="num">{fmtTime(p.duration)}</span>}{!!p.exports && <span className="project-exported" title={`${p.exports} فيديو مصدّر في renders/`}><Icon name="download" />مُصدَّر</span>}</div>;
}

/** what the server is doing for this project right now (analysis, export, an AI task) */
function ProjectJobs({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return null;
  const j = jobs.find((x) => x.status === 'running') ?? jobs[0];
  const pct = j.status === 'running' && j.progress > 0 ? Math.round(j.progress * 100) : undefined;
  const label = j.kind === 'agent' ? 'مساعد AI يشتغل' : j.status === 'queued' ? `بالانتظار: ${j.label}` : j.label;
  return <div className="project-job" title={j.label}>
    <Spinner size={12} /><span dir="auto">{label}</span>{pct !== undefined && <span className="num">{pct}%</span>}{jobs.length > 1 && <span className="count-badge num">+{jobs.length - 1}</span>}
    {pct !== undefined && <i style={{ width: `${pct}%` }} />}
  </div>;
}

function ProjectDialog({ kind, project, onClose, onDeleted }: { kind: 'rename' | 'delete'; project: ProjectSummary; onClose(): void; onDeleted(p: TrashedProject): void }) {
  const [name, setName] = useState(titleOf(project)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const connected = useStore((s) => s.connection === 'connected');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy || !connected) return;
    if (kind === 'rename' && (!name.trim() || /[\u0000-\u001f\u007f]/.test(name))) { setError('اكتب اسمًا من ١ إلى ١٢٠ حرفًا دون محارف تحكّم.'); return; }
    setBusy(true); setError('');
    try {
      if (kind === 'rename') { await useStore.getState().renameProject(project.name, name); useStore.getState().notify('تم تحديث اسم المشروع.', 'info'); onClose(); }
      else onDeleted(await useStore.getState().deleteProject(project.name));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title={kind === 'rename' ? 'اسم جديد لنفس القصة' : 'نقل المشروع إلى المحذوفات؟'} subtitle={kind === 'rename' ? 'اختر اسمًا يسهل عليك العثور عليه.' : 'يمكنك استعادة المشروع وملفاته خلال 30 يومًا؛ بعدها تُفرغ المحذوفات تلقائيًا.'} initialFocus={kind === 'rename' ? '#rename-project' : '[data-cancel-project]'} onClose={() => { if (!busy) onClose(); }}>
    <form className="modal-body project-dialog-form" onSubmit={submit} aria-busy={busy}>{kind === 'rename' ? <><label htmlFor="rename-project">اسم المشروع</label><input id="rename-project" className="field" dir="auto" value={name} maxLength={120} required disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'project-dialog-error' : undefined} onFocus={(e) => e.target.select()} onChange={(e) => { setName(e.target.value); setError(''); }} /></> : <div className="project-delete-summary"><Icon name="folder" size={26} /><strong dir="auto">{titleOf(project)}</strong><p>سيختفي المشروع من مكتبتك، وتبقى جميع ملفاته محفوظة للاستعادة.</p></div>}{error && <p id="project-dialog-error" className="home-inline-error" role="alert">{error}</p>}{!connected && <p className="notice" role="status">انتظر عودة الاتصال لإكمال العملية.</p>}<div className="project-dialog-actions"><button type="button" className="btn" data-cancel-project disabled={busy} onClick={onClose}>إلغاء</button><button className={`btn ${kind === 'delete' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !connected || (kind === 'rename' && (!name.trim() || name.trim() === titleOf(project)))}>{busy ? <Spinner size={16} /> : <Icon name={kind === 'delete' ? 'trash' : 'edit'} />}{busy ? 'جارٍ الحفظ…' : kind === 'delete' ? 'نقل إلى المحذوفات' : 'حفظ الاسم'}</button></div></form>
  </Modal>;
}

/**
 * The project's cover (rendered like the export, at its own shape) — and on hover a strip of frames
 * across the edit, scrubbed by the pointer like a playhead.
 */
function ProjectCover({ project }: { project: ProjectSummary }) {
  const base = `${projectPath(project.name)}`, v = Math.round(project.modified);
  const hasPicture = !!project.media && (project.duration ?? 0) > 0;
  const [cover, setCover] = useState<'loading' | 'ok' | 'none'>(hasPicture ? 'loading' : 'none');
  const [strip, setStrip] = useState<string>();
  const [at, setAt] = useState<number>();
  useEffect(() => { setCover(hasPicture ? 'loading' : 'none'); setStrip(undefined); }, [hasPicture, v]);
  const [w, h] = (project.aspect ?? '16:9').split(':').map(Number);
  // the strip is fetched once the cover is in (the server makes them one at a time), so a hover finds it ready
  useEffect(() => { if (cover === 'ok') loadStrip(); }, [cover]);
  const loadStrip = () => {
    if (strip || cover !== 'ok') return;
    const url = `${base}/strip.jpg?v=${v}`;
    const img = new Image();
    img.onload = () => setStrip(url);
    img.src = url;
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const frame = at !== undefined && strip ? Math.floor(at * STRIP_FRAMES) : undefined;
  // no picture: the name's first letter on a tint picked from the name, so empty projects tell apart
  const title = titleOf(project), tint = TINTS[[...title].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 9973, 7) % TINTS.length];
  return (
    <div className="project-cover" data-art={cover === 'ok'} aria-hidden="true" style={{ '--tint': `var(${tint})` } as React.CSSProperties} onPointerMove={move} onPointerLeave={() => setAt(undefined)}>
      <span className="project-cover-initial" dir="auto">{[...title.trim()][0]?.toLocaleUpperCase() ?? ''}</span>
      <span className="project-cover-label">{project.media ? 'مشروع مونتاج' : 'قصة لم تبدأ بعد'}</span>
      {cover !== 'none' && (
        <div className="project-cover-art" style={{ opacity: cover === 'ok' ? 1 : 0 }}>
          <div className="project-cover-backdrop" style={{ backgroundImage: `url("${base}/cover.jpg?v=${v}")` }} />
          <div className="project-cover-frame" style={{ aspectRatio: `${w} / ${h}` }}>
            <img src={`${base}/cover.jpg?v=${v}`} alt="" loading="lazy" onLoad={() => setCover('ok')} onError={() => setCover('none')} />
            {frame !== undefined && <div className="project-cover-strip" style={{ backgroundImage: `url("${strip}")`, backgroundSize: `${STRIP_FRAMES * 100}% 100%`, backgroundPosition: `${(frame / (STRIP_FRAMES - 1)) * 100}% 0` }} />}
          </div>
          {at !== undefined && cover === 'ok' && <div className="project-cover-playhead" style={{ left: `${at * 100}%` }} />}
        </div>
      )}
      {project.aspect && project.aspect !== '16:9' && <span className="project-cover-aspect num">{project.aspect}</span>}
      <span className="project-cover-mark"><i /><i /><i /></span>
    </div>
  );
}

function PermanentDelete({ target, count, onClose, onDone }: { target: TrashedProject | 'all'; count: number; onClose(): void; onDone(): Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const connected = useStore((s) => s.connection === 'connected');
  const remove = async () => {
    if (busy || !connected) return;
    setBusy(true); setError('');
    try { await api.delete(`/api/projects/.trash${target === 'all' ? '' : `/${target.id}`}`); await onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title={target === 'all' ? 'إفراغ المحذوفات؟' : 'حذف نهائي؟'} subtitle="سيُحذف المشروع وملفاته نهائيًا. لا يمكن التراجع عن هذا الإجراء." initialFocus="[data-cancel-permanent]" onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body project-dialog-form"><p>{target === 'all' ? `سيُحذف ${count} مشروع من المحذوفات.` : `حذف «${titleOf(target)}» وملفاته نهائيًا؟`}</p>{error && <p className="home-inline-error" role="alert">{error}</p>}<div className="project-dialog-actions"><button className="btn" data-cancel-permanent disabled={busy} onClick={onClose}>إلغاء</button><button className="btn btn-danger" disabled={busy || !connected} onClick={remove}>{busy ? 'جارٍ الحذف…' : target === 'all' ? 'إفراغ المحذوفات' : 'حذف نهائي'}</button></div></div>
  </Modal>;
}
