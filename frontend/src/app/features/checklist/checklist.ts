import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { RequirementService } from '../../core/requirement.service';
import { AiService, AiLanguage } from '../../core/ai.service';

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
  files: string[]; // always array
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

  selectedArea: string = 'ALL';
  selectedLevel: number | 'ALL' = 'ALL';
  search = '';

  expanded: Record<string, boolean> = {};
  saving: Record<string, boolean> = {};

  loading = false;
  error = '';

  role = (localStorage.getItem('role') || '').toUpperCase();

  // AI state
  aiLoading: Record<string, Record<string, boolean>> = {}; // {reqId:{lang:true}}
  aiError: Record<string, Record<string, string>> = {}; // {reqId:{lang:"msg"}}
  aiStore: Record<string, Record<string, AiPayload>> = {}; // {reqId:{lang:{...}}}
  aiActiveLang: Record<string, string> = {}; // {reqId:"java"}

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

  // ── permissions ──────────────────────────────────────────
  get canSetStatus() {
    return this.role === 'ADMIN' || this.role === 'DEVELOPER';
  }
  get canEditEvidence() {
    return this.role === 'DEVELOPER';
  }
  get canSeeStats() {
    return this.role === 'ADMIN' || this.role === 'AUDITOR';
  }

  constructor(
    private route: ActivatedRoute,
    private reqs: RequirementService,
    private location: Location,
    private cdr: ChangeDetectorRef,
    private ai: AiService
  ) {}

  // ── session storage ───────────────────────────────────────
  private storageKey(projectId: string) {
    return `checklist_state_${projectId}`;
  }

  private restoreState(projectId: string) {
    try {
      const raw = sessionStorage.getItem(this.storageKey(projectId));
      if (!raw) return;
      const s = JSON.parse(raw) as ChecklistState;
      this.selectedArea = s.selectedArea ?? 'ALL';
      this.selectedLevel = (s.selectedLevel ?? 'ALL') as any;
      this.search = s.search ?? '';
      this.expanded = s.expanded ?? {};
    } catch {
      // ignore
    }
  }

  private saveState() {
    if (!this.projectId) return;
    const state: ChecklistState = {
      selectedArea: this.selectedArea,
      selectedLevel: this.selectedLevel,
      search: this.search,
      expanded: this.expanded,
    };
    try {
      sessionStorage.setItem(this.storageKey(this.projectId), JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  // ── lifecycle ─────────────────────────────────────────────
  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const newId = params.get('id') || '';
      this.projectId = newId;

      if (this.projectId) this.restoreState(this.projectId);
      this.loadAll();
    });
  }

  ngOnDestroy(): void {
    this.saveState();
  }

  goBack() {
    this.saveState();
    this.location.back();
  }

  // ── filters ───────────────────────────────────────────────
  setArea(a: string) {
    this.selectedArea = a;
    this.saveState();
  }

  setLevel(l: number | 'ALL') {
    this.selectedLevel = l;
    this.saveState();
  }

  setSearch(v: string) {
    this.search = v;
    this.saveState();
  }

  // ── data loading ──────────────────────────────────────────
  loadAll() {
    if (!this.projectId) return;

    this.loading = true;
    this.error = '';

    this.reqs.getChecklist(this.projectId).subscribe({
      next: (res: any[]) => {
        this.requirements = (res || []).map((r) => {
          if (!r.progress) r.progress = {};
          r.progress.status = r.progress.status || 'UNTESTED';
          r.progress.applicability = r.progress.applicability || 'YES';
          r.progress.comment = r.progress.comment || '';
          r.progress.tool_used = r.progress.tool_used || '';
          r.progress.source_code_reference = r.progress.source_code_reference || '';
          return r;
        });

        // auto-expand first item only when no previous state
        if (!Object.keys(this.expanded || {}).length && this.requirements.length) {
          this.expanded[this.requirements[0]['#']] = true;
        }

        this.loading = false;

        if (this.canSeeStats) this.refreshStats();
        else this.stats = null;

        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loading = false;
        this.requirements = [];
        this.stats = null;
        this.error = err?.error?.error || err?.message || 'Failed to load checklist';
        this.cdr.detectChanges();
      },
    });
  }

  refreshStats() {
    if (!this.canSeeStats || !this.projectId) {
      this.stats = null;
      return;
    }

    this.reqs.getStats(this.projectId).subscribe({
      next: (s) => (this.stats = s),
      error: () => (this.stats = null),
    });
  }

  // ── computed lists ────────────────────────────────────────
  get areas(): AreaItem[] {
    const map = new Map<string, number>();
    for (const r of this.requirements) {
      const area = r['Area'] || 'Other';
      map.set(area, (map.get(area) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get filtered(): any[] {
    return this.requirements.filter((r) => {
      const areaOk = this.selectedArea === 'ALL' || r['Area'] === this.selectedArea;

      const lvl = Number(r['ASVS Level']);
      const levelOk = this.selectedLevel === 'ALL' || lvl === this.selectedLevel;

      const q = this.search.trim().toLowerCase();
      const text = `${r['#']} ${r['Verification Requirement']} ${r['CWE']} ${r['Area']}`.toLowerCase();
      const searchOk = !q || text.includes(q);

      return areaOk && levelOk && searchOk;
    });
  }

  trackByReq = (_: number, r: any) => r['#'];

  // ── UI helpers ────────────────────────────────────────────
  toggle(reqId: string) {
    this.expanded[reqId] = !this.expanded[reqId];
    this.saveState();
  }

  openReq(r: any) {
    this.activeReq = r;
    this.showOutputPanel = true;
  }

  closeOutputPanel() {
    this.showOutputPanel = false;
    this.activeReq = null;
  }

  statusClass(status: string): string {
    const s = String(status || '').toUpperCase();
    if (s === 'DONE') return 'DONE';
    if (s === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (s === 'NOT_DONE') return 'NOT_DONE';
    if (s === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
    return 'UNTESTED';
  }

  // ── status setters ────────────────────────────────────────
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

  setAiActiveLang(reqId: string, lang: string) {
    this.aiActiveLang[reqId] = lang;
  }

  private setAiStore(reqId: string, lang: string, data: AiPayload) {
    if (!this.aiStore[reqId]) this.aiStore[reqId] = {};
    this.aiStore[reqId][lang] = data;
    this.aiActiveLang[reqId] = lang; // always focus latest result
  }

  clearAi(reqId: string, lang: string) {
    if (this.aiStore[reqId]) {
      delete this.aiStore[reqId][lang];
      if (this.aiError[reqId]) delete this.aiError[reqId][lang];

      const remaining = Object.keys(this.aiStore[reqId] || {});
      if (remaining.length) this.aiActiveLang[reqId] = remaining[0];
      else delete this.aiActiveLang[reqId];
    }
    this.cdr.detectChanges();
  }

  /** Returns true if ANY language is currently loading for this requirement */
  aiLoadingAny(reqId: string): boolean {
    const m = this.aiLoading?.[reqId] || {};
    return Object.values(m).some((v) => v);
  }

  /** Returns true if a specific language is currently loading */
  aiLoadingLang(reqId: string, lang: string): boolean {
    return !!this.aiLoading?.[reqId]?.[lang];
  }

  /** Returns true if a result exists for this req + lang */
  hasAiResult(reqId: string, lang: string): boolean {
    return !!this.aiStore?.[reqId]?.[lang];
  }

  // ── AI generate ───────────────────────────────────────────
  aiSuggest(r: any, langKey: AiLanguage) {
    if (!this.canEditEvidence) return;

    const reqId = r['#'];
    if (!reqId) return;

    // open output panel and focus this requirement
    this.openReq(r);

    // prevent double-click while loading
    if (this.aiLoadingLang(reqId, langKey)) return;

    this.setAiLoading(reqId, langKey, true);
    this.setAiError(reqId, langKey, '');

    const payload = {
      projectId: this.projectId,
      requirementId: reqId,
      title: r['Verification Requirement'],
      requirementText: r['Verification Requirement'],
      area: r['Area'],
      cwe: r['CWE'],
      level: r['ASVS Level'],
      language: langKey,
    };

    this.ai.suggest(payload as any).subscribe({
      next: (resp: any) => {
        const filesArr: string[] = Array.isArray(resp?.files)
          ? resp.files.map((x: any) => String(x))
          : typeof resp?.files === 'string'
            ? resp.files
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [];

        const codeStr: string =
          typeof resp?.code === 'string'
            ? String(resp.code)
            : resp?.code && typeof resp.code === 'object'
              ? Object.entries(resp.code)
                  .map(([name, content]) => `// ===== File: ${name} =====\n${String(content ?? '')}`)
                  .join('\n\n')
              : '';

        const data: AiPayload = {
          requirementId: String(resp?.requirementId || reqId),
          language: String(resp?.language || langKey),
          summary: String(resp?.summary || ''),
          what_to_do: Array.isArray(resp?.what_to_do) ? resp.what_to_do.map(String) : [],
          evidence: String(resp?.evidence || ''),
          files: filesArr,
          code: codeStr,
          assumptions: Array.isArray(resp?.assumptions) ? resp.assumptions.map(String) : [],
          questions: Array.isArray(resp?.questions) ? resp.questions.map(String) : [],
          raw: resp ?? null,
        };

        this.setAiStore(reqId, langKey, data);
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

  // ── Apply AI result to evidence fields ────────────────────
  applyAiToEvidence(r: any, langKey: string) {
    if (!this.canEditEvidence) return;

    const reqId = r['#'];
    const data = this.aiStore?.[reqId]?.[langKey];
    if (!data) return;

    const filesStr = data.files?.length ? data.files.join(', ') : '';

    const block =
      `AI (${langKey})\n` +
      (data.summary ? `\nSummary:\n${data.summary}\n` : '') +
      (data.what_to_do?.length ? `\nWhat to do:\n- ${data.what_to_do.join('\n- ')}\n` : '') +
      (data.evidence ? `\nEvidence (paste):\n${data.evidence}\n` : '') +
      (filesStr ? `\nSource code reference:\n${filesStr}\n` : '');

    r.progress.comment = (r.progress.comment ? r.progress.comment + '\n\n' : '') + block.trim();
    r.progress.tool_used = `AI - ${langKey}`;
    if (filesStr) r.progress.source_code_reference = filesStr;

    this.cdr.detectChanges();
  }

  // ── Copy helpers ───────────────────────────────────────────
  copied: Record<string, boolean> = {}; // `${reqId}:${lang}:${field}`

  private copyKey(reqId: string, lang: string, field: 'code' | 'summary' | 'evidence' | 'all') {
    return `${reqId}:${lang}:${field}`;
  }

  isCopied(reqId: string, lang: string, field: 'code' | 'summary' | 'evidence' | 'all') {
    return !!this.copied[this.copyKey(reqId, lang, field)];
  }

  private setCopied(reqId: string, lang: string, field: 'code' | 'summary' | 'evidence' | 'all') {
    const k = this.copyKey(reqId, lang, field);
    this.copied[k] = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.copied[k] = false;
      this.cdr.detectChanges();
    }, 1200);
  }

  async copyText(reqId: string, lang: string, field: 'code' | 'summary' | 'evidence', text: string) {
    const value = String(text || '').trim();
    if (!value) return;

    try {
      const nav = window?.navigator as any;

      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      this.setCopied(reqId, lang, field);
    } catch {
      alert('Copy failed. Please copy manually.');
    }
  }

  // ✅ optional: Copy all (Summary + What to do + Evidence + Files + Code)
  async copyAll(reqId: string, lang: string) {
    const data = this.aiStore?.[reqId]?.[lang];
    if (!data) return;

    const block =
      `Requirement: ${reqId}\nLanguage: ${lang}\n\n` +
      (data.summary ? `Summary:\n${data.summary}\n\n` : '') +
      (data.what_to_do?.length ? `What to do:\n- ${data.what_to_do.join('\n- ')}\n\n` : '') +
      (data.evidence ? `Evidence:\n${data.evidence}\n\n` : '') +
      (data.files?.length ? `Files:\n${data.files.join('\n')}\n\n` : '') +
      (data.code ? `Code:\n${data.code}\n` : '');

    try {
      const nav = window?.navigator as any;
      if (nav?.clipboard?.writeText) await nav.clipboard.writeText(block);
      else {
        const ta = document.createElement('textarea');
        ta.value = block;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      this.setCopied(reqId, lang, 'all');
    } catch {
      alert('Copy failed. Please copy manually.');
    }
  }

  // ── Save to backend ───────────────────────────────────────
  save(r: any) {
    const reqId = r['#'];
    if (!reqId) return;

    this.saving[reqId] = true;

    let payload: any = {
      status: r.progress.status,
      applicability: r.progress.applicability,
    };

    if (this.canEditEvidence) {
      payload = {
        ...payload,
        comment: r.progress.comment,
        tool_used: r.progress.tool_used,
        source_code_reference: r.progress.source_code_reference,
      };
    }

    this.reqs.updateRequirement(this.projectId, reqId, payload).subscribe({
      next: () => {
        this.saving[reqId] = false;
        this.refreshStats();
        this.saveState();
      },
      error: (err) => {
        this.saving[reqId] = false;
        alert(err?.error?.error || err?.message || 'Checklist API error');
      },
    });
  }
}