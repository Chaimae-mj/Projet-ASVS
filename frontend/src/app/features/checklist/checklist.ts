import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { RequirementService } from '../../core/requirement.service';
import { AiService, AiLanguage } from '../../core/ai.service';
import { LanguageService } from '../../core/services/language.service';
import { ThemeService } from '../../core/services/theme.service';
import * as XLSX from 'xlsx';
import { ProjectService } from '../../core/project.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ProjectStats } from '../../core/requirement.service';

const CAT_META: Record<string, { icon: string }> = {
  'Architecture': { icon: '🏗' },
  'Authentication': { icon: '🔐' },
  'Session Management': { icon: '🕐' },
  'Access Control': { icon: '🛡' },
  'Input Validation': { icon: '🔎' },
  'Cryptography at Rest': { icon: '🔒' },
  'Error Handling and Logging': { icon: '⚠️' },
  'Data Protection': { icon: '🗄' },
  'Communication Security': { icon: '📡' },
  'Malicious Code': { icon: '🦠' },
  'Business Logic': { icon: '💼' },
  'Files and Resources': { icon: '📁' },
  'API and Web Service': { icon: '🔌' },
  'Configuration': { icon: '⚙️' },
};

type AreaItem = { name: string; count: number };

type ChecklistState = {
  selectedArea: string;
  selectedLevel: number | 'ALL';
  search: string;
  expanded: Record<string, boolean>;
};

type AiPayload = {
  requirementId: string;
  language: string;
  summary: string;
  what_to_do: string[];
  evidence: string;
  code: string;
  files: string[];
  assumptions: string[];
  questions: string[];
  raw: any;
};

@Component({
  standalone: true,
  selector: 'app-checklist',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './checklist.html',
  styleUrls: ['./checklist.scss'],
})
export class Checklist implements OnInit, OnDestroy {
  projectId = '';
  requirements: any[] = [];
  stats: any = null;
  currentProject: any = null;

  projects: any[] = [];
  projectStatsMap: Record<string, ProjectStats> = {};
  newProjectName = '';
  creating = false;

  selectedArea: string = 'ALL';
  selectedLevel: number | 'ALL' = 'ALL';
  search = '';
  areasList: AreaItem[] = [];
  filteredReqs: any[] = [];
  statCategories: any[] = [];

  expanded: Record<string, boolean> = {};
  saving: Record<string, boolean> = {};
  saved: Record<string, boolean> = {};

  loading = false;
  error = '';

  // ── Toast ─────────────────────────────────────────────────
  showToast = false;
  private toastTimer: any;

  role = (localStorage.getItem('role') || '').toUpperCase();

  aiLoading: Record<string, Record<string, boolean>> = {};
  aiError: Record<string, Record<string, string>> = {};
  aiStore: Record<string, Record<string, AiPayload>> = {};
  aiActiveLang: Record<string, string> = {};

  showOutputPanel = false;
  activeReq: any = null;

  aiLanguages: { key: AiLanguage; label: string }[] = [
    { key: 'java', label: 'AI Java' },
    { key: 'javascript', label: 'AI JS' },
    { key: 'python', label: 'AI Python' },
    { key: 'csharp', label: 'AI C#' },
    { key: 'php', label: 'AI PHP' },
    { key: 'go', label: 'AI Go' },
    { key: 'kotlin', label: 'AI Kotlin' },
  ];

  constructor(
    private route: ActivatedRoute,
    private reqs: RequirementService,
    private location: Location,
    private cdr: ChangeDetectorRef,
    private ai: AiService,
    public langService: LanguageService,
    public themeService: ThemeService,
    private projectService: ProjectService
  ) {}

  t(key: string) { return this.langService.translate(key); }

  get isAdmin(): boolean { return this.role === 'ADMIN' || this.role === 'ADMINISTRATEUR'; }
  get isDeveloper(): boolean { return this.role === 'DEVELOPER' || this.role === 'DÉVELOPPEUR'; }
  get isAuditor(): boolean { return this.role === 'AUDITOR' || this.role === 'AUDITEUR'; }

  getIcon(name: string): string { return CAT_META[name]?.icon || '📁'; }

  get canSetStatus() {
    return this.role === 'ADMIN' || this.role === 'ADMINISTRATEUR';
  }
  get canEditEvidence() {
    return this.role === 'DEVELOPER' || this.role === 'DÉVELOPPEUR';
  }
  get canSeeStats() {
    return ['ADMIN', 'AUDITOR', 'DEVELOPER', 'ADMINISTRATEUR', 'AUDITEUR', 'DÉVELOPPEUR'].includes(this.role);
  }

  // ── Toast trigger ─────────────────────────────────────────
  triggerToast() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.showToast = true;
    this.cdr.detectChanges();
    this.toastTimer = setTimeout(() => {
      this.showToast = false;
      this.cdr.detectChanges();
    }, 2500);
  }

  // ── session storage ───────────────────────────────────────
  private storageKey(id: string) { return `checklist_state_${id}`; }

  private restoreState(id: string) {
    try {
      const raw = sessionStorage.getItem(this.storageKey(id));
      if (!raw) {
        this.selectedArea = 'ALL'; this.selectedLevel = 'ALL';
        this.search = ''; this.expanded = {};
        return;
      }
      const s = JSON.parse(raw) as ChecklistState;
      this.selectedArea  = s.selectedArea  ?? 'ALL';
      this.selectedLevel = (s.selectedLevel ?? 'ALL') as any;
      this.search        = s.search        ?? '';
      this.expanded      = s.expanded      ?? {};
    } catch {}
  }

  private saveState() {
    if (!this.projectId) return;
    try {
      sessionStorage.setItem(this.storageKey(this.projectId), JSON.stringify({
        selectedArea: this.selectedArea, selectedLevel: this.selectedLevel,
        search: this.search, expanded: this.expanded,
      }));
    } catch {}
  }

  // ── lifecycle ─────────────────────────────────────────────
  ngOnInit(): void {
    // 1. Lire le projectId depuis l'URL
    this.route.paramMap.subscribe((params) => {
      const newId = params.get('id') || '';
      if (this.projectId !== newId) {
        this.projectId = newId;
        if (this.projectId) this.restoreState(this.projectId);
      }
    });

    // 2. Charger les projets D'ABORD, puis loadAll
    this.projectService.refreshProjects().subscribe(() => {
      this.projects = (this.projectService as any)['projectsSubject'].getValue();
      this.syncCurrentProject();
      this.loadProjectStats();
      this.loadAll();
    });

    // 3. Rester en sync si la liste change après
    this.projectService.projects$.subscribe(ps => {
      if (!ps) return;
      this.projects = ps;
      this.syncCurrentProject();
      this.loadProjectStats();
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.saveState();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  goBack() { this.saveState(); this.location.back(); }

  // ── helpers ───────────────────────────────────────────────
  loadProjects() { this.projectService.refreshProjects().subscribe(); }

  loadProjectStats() {
    if (!this.projects.length) return;
    forkJoin(this.projects.map(p => this.reqs.getStats(p.id).pipe(catchError(() => of(null)))))
      .subscribe(results => {
        results.forEach((s, i) => {
          if (s && this.projects[i]) this.projectStatsMap[this.projects[i].id] = s;
        });
        this.cdr.detectChanges();
      });
  }

  syncCurrentProject() {
    if (this.projectId && this.projects.length)
      this.currentProject = this.projects.find(p => p.id === this.projectId);
  }

  createProject() {
    if (!this.newProjectName.trim()) return;
    this.creating = true;
    this.projectService.createProject(this.newProjectName).subscribe({
      next: () => { this.newProjectName = ''; this.creating = false; this.loadProjects(); },
      error: () => this.creating = false
    });
  }

  // ── filters ───────────────────────────────────────────────
  setArea(a: string) {
    this.selectedArea = a; this.updateFiltered(); this.saveState();
    const el = document.querySelector('.req-list');
    if (el) el.scrollTop = 0;
  }
  setLevel(l: number | 'ALL') { this.selectedLevel = l; this.updateFiltered(); this.saveState(); }
  setSearch(v: string)        { this.search = v;         this.updateFiltered(); this.saveState(); }

  // ── data loading ──────────────────────────────────────────
  loadAll() {
    if (!this.projectId) return;
    this.loading = true;
    this.error = '';

    this.reqs.getChecklist(this.projectId).subscribe({
      next: (res: any[]) => {
        this.requirements = (res || []).map((r) => {
          if (!r.progress) r.progress = {};
          r.progress.status                = r.progress.status                || 'UNTESTED';
          r.progress.applicability         = r.progress.applicability         || 'YES';
          r.progress.comment               = r.progress.comment               || '';
          r.progress.admin_comment         = r.progress.admin_comment         || '';
          r.progress.admin_reply           = r.progress.admin_reply           || '';
          r.progress.tool_used             = r.progress.tool_used             || '';
          r.progress.source_code_reference = r.progress.source_code_reference || '';
          return r;
        });

        if (!Object.keys(this.expanded || {}).length && this.requirements.length)
          this.expanded[this.requirements[0]['#']] = true;

        this.loading = false;

        const areaMap = new Map<string, number>();
        for (const r of this.requirements) {
          const area = r['Area'] || 'Other';
          areaMap.set(area, (areaMap.get(area) || 0) + 1);
        }
        this.areasList = Array.from(areaMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name));

        // ✅ sync currentProject après chargement
        this.syncCurrentProject();

        if (this.canSeeStats) this.refreshStats();
        else { this.stats = null; this.statCategories = []; }

        this.updateFiltered();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loading = false;
        this.requirements = []; this.stats = null; this.statCategories = [];
        this.error = err?.error?.error || err?.message || 'Failed to load checklist';
        this.updateFiltered();
        this.cdr.detectChanges();
      },
    });
  }

  refreshStats() {
    if (!this.canSeeStats || !this.projectId) { this.stats = null; this.statCategories = []; return; }
    this.reqs.getStats(this.projectId).subscribe({
      next: (s) => {
        this.stats = s;
        this.statCategories = s?.categories
          ? Object.entries(s.categories)
              .map(([key, value]) => ({ key, value }))
              .sort((a, b) => a.key.localeCompare(b.key))
          : [];
        this.cdr.detectChanges();
      },
      error: () => { this.stats = null; this.statCategories = []; }
    });
  }

  get areas(): AreaItem[] { return this.areasList; }
  get filtered(): any[]   { return this.filteredReqs; }

  updateFiltered() {
    const q = (this.search || '').trim().toLowerCase();
    this.filteredReqs = (this.requirements || []).filter((r) => {
      if (!r) return false;
      const areaOk   = this.selectedArea === 'ALL' || r['Area'] === this.selectedArea || r['Category'] === this.selectedArea;
      const rLvl     = parseInt(String(r['ASVS Level'] || '0'), 10);
      const levelOk  = this.selectedLevel === 'ALL' || rLvl <= parseInt(String(this.selectedLevel), 10);
      const searchOk = !q || `${r['#']} ${r['Verification Requirement']} ${r['CWE']} ${r['Area']}`.toLowerCase().includes(q);
      return areaOk && levelOk && searchOk;
    });
    this.cdr.detectChanges();
  }

  trackByReq = (_: number, r: any) => r['#'];

  toggle(reqId: string)  { this.expanded[reqId] = !this.expanded[reqId]; this.saveState(); }
  openReq(r: any)        { this.activeReq = r; this.showOutputPanel = true; }
  closeOutputPanel()     { this.showOutputPanel = false; this.activeReq = null; }

  statusClass(status: string): string {
    const s = String(status || '').toUpperCase();
    if (s === 'DONE')           return 'DONE';
    if (s === 'IN_PROGRESS')    return 'IN_PROGRESS';
    if (s === 'NOT_DONE')       return 'NOT_DONE';
    if (s === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
    return 'UNTESTED';
  }

  setStatus(r: any, status: string) {
    if (!this.canSetStatus) return;
    r.progress.status = status;
    if (status === 'NOT_APPLICABLE') r.progress.applicability = 'NA';
  }

  setApplicability(r: any, app: string) {
    if (!this.canSetStatus) return;
    r.progress.applicability = app;
    if (app === 'NA') r.progress.status = 'NOT_APPLICABLE';
  }

  // ── AI helpers ────────────────────────────────────────────
  private setAiLoading(reqId: string, lang: string, v: boolean) {
    if (!this.aiLoading[reqId]) this.aiLoading[reqId] = {};
    this.aiLoading[reqId][lang] = v;
  }
  private setAiError(reqId: string, lang: string, msg: string) {
    if (!this.aiError[reqId]) this.aiError[reqId] = {};
    this.aiError[reqId][lang] = msg;
  }
  setAiActiveLang(reqId: string, lang: string) { this.aiActiveLang[reqId] = lang; }
  private setAiStore(reqId: string, lang: string, data: AiPayload) {
    if (!this.aiStore[reqId]) this.aiStore[reqId] = {};
    this.aiStore[reqId][lang] = data;
    this.aiActiveLang[reqId] = lang;
  }
  clearAi(reqId: string, lang: string) {
    if (this.aiStore[reqId]) {
      delete this.aiStore[reqId][lang];
      if (this.aiError[reqId]) delete this.aiError[reqId][lang];
      const rem = Object.keys(this.aiStore[reqId] || {});
      if (rem.length) this.aiActiveLang[reqId] = rem[0]; else delete this.aiActiveLang[reqId];
    }
    this.cdr.detectChanges();
  }
  aiLoadingAny(reqId: string):                boolean { return Object.values(this.aiLoading?.[reqId] || {}).some(v => v); }
  aiLoadingLang(reqId: string, lang: string): boolean { return !!this.aiLoading?.[reqId]?.[lang]; }
  hasAiResult(reqId: string, lang: string):   boolean { return !!this.aiStore?.[reqId]?.[lang]; }

  // ── AI generate ───────────────────────────────────────────
  aiSuggest(r: any, langKey: AiLanguage) {
    if (!this.canEditEvidence) return;
    const reqId = r['#'];
    if (!reqId || this.aiLoadingLang(reqId, langKey)) return;
    this.openReq(r);
    this.setAiLoading(reqId, langKey, true);
    this.setAiError(reqId, langKey, '');

    this.ai.suggest({
      projectId: this.projectId, requirementId: reqId,
      title: r['Verification Requirement'], requirementText: r['Verification Requirement'],
      area: r['Area'], cwe: r['CWE'], level: r['ASVS Level'], language: langKey,
    } as any).subscribe({
      next: (resp: any) => {
        const filesArr: string[] = Array.isArray(resp?.files)
          ? resp.files.map(String)
          : typeof resp?.files === 'string'
            ? resp.files.split(',').map((s: string) => s.trim()).filter(Boolean)
            : [];
        const codeStr: string = typeof resp?.code === 'string'
          ? String(resp.code)
          : resp?.code && typeof resp.code === 'object'
            ? Object.entries(resp.code).map(([n, c]) => `// ===== File: ${n} =====\n${String(c ?? '')}`).join('\n\n')
            : '';
        this.setAiStore(reqId, langKey, {
          requirementId: String(resp?.requirementId || reqId),
          language:      String(resp?.language || langKey),
          summary:       String(resp?.summary || ''),
          what_to_do:    Array.isArray(resp?.what_to_do) ? resp.what_to_do.map(String) : [],
          evidence:      String(resp?.evidence || ''),
          files: filesArr, code: codeStr,
          assumptions:   Array.isArray(resp?.assumptions) ? resp.assumptions.map(String) : [],
          questions:     Array.isArray(resp?.questions)   ? resp.questions.map(String)   : [],
          raw: resp ?? null,
        });
        this.setAiLoading(reqId, langKey, false);
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.setAiLoading(reqId, langKey, false);
        this.setAiError(reqId, langKey, err?.error?.error || err?.message || 'AI error');
        this.cdr.detectChanges();
      },
    });
  }

  applyAiToEvidence(r: any, langKey: string) {
    if (!this.canEditEvidence) return;
    const data = this.aiStore?.[r['#']]?.[langKey];
    if (!data) return;
    const filesStr = data.files?.length ? data.files.join(', ') : '';
    const block = `AI (${langKey})\n`
      + (data.summary         ? `\nSummary:\n${data.summary}\n` : '')
      + (data.what_to_do?.length ? `\nWhat to do:\n- ${data.what_to_do.join('\n- ')}\n` : '')
      + (data.evidence        ? `\nEvidence (paste):\n${data.evidence}\n` : '')
      + (filesStr             ? `\nSource code reference:\n${filesStr}\n` : '');
    r.progress.comment = (r.progress.comment ? r.progress.comment + '\n\n' : '') + block.trim();
    r.progress.tool_used = `AI - ${langKey}`;
    if (filesStr) r.progress.source_code_reference = filesStr;
    this.cdr.detectChanges();
  }

  // ── Copy helpers ──────────────────────────────────────────
  copied: Record<string, boolean> = {};
  private copyKey(reqId: string, lang: string, field: string) { return `${reqId}:${lang}:${field}`; }
  isCopied(reqId: string, lang: string, field: any) { return !!this.copied[this.copyKey(reqId, lang, field)]; }
  private setCopied(reqId: string, lang: string, field: string) {
    const k = this.copyKey(reqId, lang, field);
    this.copied[k] = true; this.cdr.detectChanges();
    setTimeout(() => { this.copied[k] = false; this.cdr.detectChanges(); }, 1200);
  }
  async copyText(reqId: string, lang: string, field: any, text: string) {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      const nav = window?.navigator as any;
      if (nav?.clipboard?.writeText) await nav.clipboard.writeText(value);
      else {
        const ta = document.createElement('textarea');
        ta.value = value; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      this.setCopied(reqId, lang, field);
    } catch { alert('Copy failed.'); }
  }

  // ── Export Excel ──────────────────────────────────────────
  exportToExcel() {
    if (!this.requirements.length) return;
    const data = this.filtered.map(r => ({
      'ID': r['#'], 'Requirement': r['Verification Requirement'],
      'Status': r.progress.status, 'Applicability': r.progress.applicability,
      'Level': r['ASVS Level'], 'Area': r['Area'], 'CWE': r['CWE'],
      'Comment': r.progress.comment, 'Tool Used': r.progress.tool_used,
      'Source Reference': r.progress.source_code_reference,
      'Dev Message': r.progress.admin_comment,
      'Admin Reply': r.progress.admin_reply,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Checklist');
    ws['!cols'] = [
      { wch: 8 }, { wch: 60 }, { wch: 12 }, { wch: 12 }, { wch: 6 },
      { wch: 20 }, { wch: 8 }, { wch: 40 }, { wch: 15 }, { wch: 30 }, { wch: 30 }, { wch: 30 }
    ];
    XLSX.writeFile(wb, `ASVS-Checklist-${this.projectId.slice(0, 8)}.xlsx`);
  }

  // ── Save to backend ───────────────────────────────────────
  save(r: any) {
    const reqId = r['#'];
    if (!reqId) return;
    this.saving[reqId] = true;

    let payload: any = {
      status:        r.progress.status,
      applicability: r.progress.applicability,
    };

    if (this.isAdmin) {
      payload.admin_reply = r.progress.admin_reply;
    }

    if (this.canEditEvidence) {
      payload.comment               = r.progress.comment;
      payload.admin_comment         = r.progress.admin_comment;
      payload.tool_used             = r.progress.tool_used;
      payload.source_code_reference = r.progress.source_code_reference;
    }

    this.reqs.updateRequirement(this.projectId, reqId, payload).subscribe({
      next: () => {
        this.saving[reqId] = false;
        this.saved[reqId]  = true;
        this.refreshStats();
        this.saveState();
        this.triggerToast();
        setTimeout(() => { this.saved[reqId] = false; this.cdr.detectChanges(); }, 2000);
      },
      error: (err) => {
        this.saving[reqId] = false;
        alert(err?.error?.error || err?.message || 'Checklist API error');
      },
    });
  }
}