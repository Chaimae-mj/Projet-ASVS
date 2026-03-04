import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { ProjectService } from '../../core/project.service';
import { RequirementService, ProjectStats } from '../../core/requirement.service';
import { Chart, registerables } from 'chart.js';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { ThemeService } from '../../core/services/theme.service';
import { LanguageService } from '../../core/services/language.service';

Chart.register(...registerables);

const CAT_META: Record<string, { icon: string; total: number }> = {
  'Architecture': { icon: '🏗', total: 40 },
  'Authentication': { icon: '🔐', total: 57 },
  'Session Management': { icon: '🕐', total: 20 },
  'Access Control': { icon: '🛡', total: 10 },
  'Input Validation': { icon: '🔎', total: 30 },
  'Cryptography at Rest': { icon: '🔒', total: 16 },
  'Error Handling and Logging': { icon: '⚠️', total: 13 },
  'Data Protection': { icon: '🗄', total: 17 },
  'Communication Security': { icon: '📡', total: 8 },
  'Malicious Code': { icon: '🦠', total: 10 },
  'Business Logic': { icon: '💼', total: 8 },
  'Files and Resources': { icon: '📁', total: 13 },
  'API and Web Service': { icon: '🔌', total: 14 },
  'Configuration': { icon: '⚙️', total: 13 },
};

// ASVS Level distribution (total reqs per level from ASVS 4.0 — adjust if your JSON differs)
const ASVS_LEVEL_TOTALS = { l1: 138, l2: 107, l3: 39 };

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard implements OnInit, OnDestroy {
  projects: any[] = [];
  newProjectName = '';
  loading = false;
  creating = false;
  error = '';

  userRole = '';
  selectedCategory: string | null = null;

  // GitHub Modal State
  showGithubModal = false;
  selectedGithubProject: any = null;
  savingGithub = false;
  fetchingGithub = false;
  githubFilesCount: number | null = null;
  githubError = '';

  globalStats: ProjectStats | null = null;
  projectStatsMap: Record<string, ProjectStats> = {};

  categories: { name: string; icon: string; total: number; pass: number; fail: number; na: number; compliance: number }[] = [];
  categoryStats: any[] = [];

  // NEW: ASVS Level stats
  levelStats = { l1: ASVS_LEVEL_TOTALS.l1, l2: ASVS_LEVEL_TOTALS.l2, l3: ASVS_LEVEL_TOTALS.l3 };

  // NEW: Snapshot history for line chart (stored in localStorage per session)
  private complianceHistory: { label: string; done: number; not_done: number; in_progress: number }[] = [];

  private donutChart: Chart | null = null;
  private barChart: Chart | null = null;
  private lineChart: Chart | null = null;
  private pieChart: Chart | null = null;

  private colors = {
    green: '#22c55e',
    red: '#ef4444',
    gray: '#94a3b8',
    amber: '#f59e0b',
    blue: '#3b82f6',
    orange: '#f97316',
    purple: '#a855f7',
    indigo: '#6366f1',
  };

  constructor(
    private projectService: ProjectService,
    private requirementService: RequirementService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    public langService: LanguageService,
    public themeService: ThemeService
  ) { }

  t(key: string) { return this.langService.translate(key); }

  get isAdmin(): boolean { return this.userRole === 'ADMIN' || this.userRole === 'ADMINISTRATEUR'; }
  get isDeveloper(): boolean { return this.userRole === 'DEVELOPER' || this.userRole === 'DÉVELOPPEUR'; }
  get isAuditor(): boolean { return this.userRole === 'AUDITOR' || this.userRole === 'AUDITEUR'; }

  getIcon(name: string): string { return CAT_META[name]?.icon || '📁'; }

  pct(val: number): number {
    if (!this.globalStats) return 0;
    return Math.round((val / (this.globalStats.applicable || 1)) * 100);
  }

  ngOnInit(): void {
    this.userRole = (localStorage.getItem('role') || '').toUpperCase();
    this.loadComplianceHistory();

    this.projectService.projects$.subscribe((list) => {
      this.projects = list || [];
      if (list) this.loading = false;
      this.cdr.detectChanges();
      if (this.projects.length > 0) this.loadAllStats();
    });

    this.loadProjects();
    this.buildCategories();
  }

  // ── History helpers ──────────────────────────────────────────────
  private loadComplianceHistory() {
    try {
      const raw = localStorage.getItem('compliance_history');
      this.complianceHistory = raw ? JSON.parse(raw) : [];
    } catch {
      this.complianceHistory = [];
    }
  }

  private saveSnapshot(done: number, not_done: number, in_progress: number) {
    const now = new Date();
    const label = `${now.getDate()}/${now.getMonth() + 1} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Avoid duplicate consecutive snapshots
    const last = this.complianceHistory[this.complianceHistory.length - 1];
    if (last && last.done === done && last.not_done === not_done) return;

    this.complianceHistory.push({ label, done, not_done, in_progress });

    // Keep max 10 snapshots
    if (this.complianceHistory.length > 10) {
      this.complianceHistory = this.complianceHistory.slice(-10);
    }

    try {
      localStorage.setItem('compliance_history', JSON.stringify(this.complianceHistory));
    } catch { }
  }
  // ─────────────────────────────────────────────────────────────────

  buildCategories() {
    this.categories = Object.entries(CAT_META).map(([name, meta]) => ({
      name, icon: meta.icon, total: meta.total,
      pass: 0, fail: 0, na: 0, compliance: 0,
    }));
  }

  loadProjects() {
    this.loading = true;
    this.error = '';
    this.projectService.refreshProjects().subscribe({
      next: () => { this.loading = false; this.cdr.detectChanges(); },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Failed to load projects';
        this.cdr.detectChanges();
      }
    });
  }

  loadAllStats() {
    if (!this.projects.length) return;

    const calls = this.projects.map(p =>
      this.requirementService.getStats(p.id).pipe(catchError(() => of(null)))
    );

    forkJoin(calls).subscribe((results) => {
      const statsMap: Record<string, ProjectStats> = {};
      let done = 0, inProg = 0, notDone = 0, untested = 0, applicable = 0, notApp = 0, total = 0;
      const catAgg: Record<string, { total: number; done: number; not_done: number; not_applicable: number; applicable: number }> = {};

      results.forEach((s, i) => {
        if (s && this.projects[i]) {
          statsMap[this.projects[i].id] = s;
          done += s.status.done;
          inProg += s.status.in_progress;
          notDone += s.status.not_done;
          untested += s.status.untested;
          applicable += s.applicable;
          notApp += s.status.not_applicable;
          total += s.total;

          if (s.categories) {
            Object.entries(s.categories).forEach(([name, c]: [string, any]) => {
              if (!catAgg[name]) catAgg[name] = { total: 0, done: 0, not_done: 0, not_applicable: 0, applicable: 0 };
              catAgg[name].total += c.total;
              catAgg[name].done += c.done;
              catAgg[name].not_done += c.not_done;
              catAgg[name].not_applicable += c.not_applicable;
              catAgg[name].applicable += (c.total - c.not_applicable);
            });
          }
        }
      });

      this.projectStatsMap = statsMap;
      const compliance = applicable === 0 ? 0 : Math.round((done / applicable) * 100);

      this.globalStats = {
        total, applicable,
        excluded: { no: 0, na: 0 },
        status: { done, in_progress: inProg, not_done: notDone, not_applicable: notApp, untested },
        compliance_percent: compliance,
        categories: {}
      };

      this.categoryStats = this.categories.map(cat => {
        const agg = catAgg[cat.name];
        if (agg) {
          return {
            name: cat.name, total: agg.total, done: agg.done, fail: agg.not_done, na: agg.not_applicable,
            percent: agg.applicable === 0 ? 0 : Math.round((agg.done / agg.applicable) * 100)
          };
        }
        return { name: cat.name, total: cat.total, done: 0, fail: 0, na: 0, percent: 0 };
      });

      // Save snapshot for line chart history
      this.saveSnapshot(done, notDone, inProg);

      this.cdr.detectChanges();
      setTimeout(() => {
        this.drawDonut();
        this.drawBar();
        this.drawLineChart();
        this.drawPieChart();
      }, 150);
    });
  }

  // ── Existing charts ──────────────────────────────────────────────
  drawDonut() {
    const canvas = document.getElementById('globalDonutChart') as HTMLCanvasElement;
    if (!canvas || !this.globalStats) return;
    if (this.donutChart) { this.donutChart.destroy(); this.donutChart = null; }
    const s = this.globalStats.status;
    const pct = this.globalStats.compliance_percent;
    const isDark = this.themeService.isDarkMode;

    this.donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: [this.t('PASS'), this.t('FAIL'), 'N/A', this.t('UNREVIEWED')],
        datasets: [{
          data: [s.done, s.not_done, s.not_applicable, s.untested + s.in_progress],
          backgroundColor: [this.colors.green, this.colors.red, this.colors.gray, this.colors.amber],
          borderWidth: 3, borderColor: isDark ? '#1e293b' : '#fff', hoverOffset: 6,
        }]
      },
      plugins: [{
        id: 'center',
        afterDraw: (chart: any) => {
          const { ctx, chartArea: { top, bottom, left, right } } = chart;
          const cx = (left + right) / 2, cy = (top + bottom) / 2;
          ctx.save();
          ctx.font = 'bold 24px Outfit';
          ctx.fillStyle = pct >= 75 ? '#16a34a' : pct >= 25 ? '#d97706' : '#dc2626';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`${pct}%`, cx, cy - 8);
          ctx.font = '11px Outfit'; ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
          ctx.fillText(this.t('COMPLIANCE').toLowerCase(), cx, cy + 12);
          ctx.restore();
        }
      }],
      options: {
        cutout: '70%',
        plugins: { legend: { display: false } },
        animation: { duration: 1000 }
      }
    });
  }

  drawBar() {
    const canvas = document.getElementById('projectsBarChart') as HTMLCanvasElement;
    if (!canvas) return;
    if (this.barChart) { this.barChart.destroy(); this.barChart = null; }
    const isDark = this.themeService.isDarkMode;

    const labels = this.projects.map(p => p.name.length > 12 ? p.name.slice(0, 12) + '…' : p.name);
    const done = this.projects.map(p => this.projectStatsMap[p.id]?.status.done ?? 0);
    const inProg = this.projects.map(p => this.projectStatsMap[p.id]?.status.in_progress ?? 0);
    const notDone = this.projects.map(p => this.projectStatsMap[p.id]?.status.not_done ?? 0);

    this.barChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: this.t('PASS'), data: done, backgroundColor: this.colors.green + 'dd', borderRadius: 5 },
          { label: this.t('UNREVIEWED'), data: inProg, backgroundColor: this.colors.blue + 'dd', borderRadius: 5 },
          { label: this.t('FAIL'), data: notDone, backgroundColor: this.colors.red + 'dd', borderRadius: 5 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, padding: 14, font: { size: 11, family: 'Outfit' }, color: isDark ? '#f8fafc' : '#1e293b' }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10, family: 'Outfit' }, color: isDark ? '#94a3b8' : '#64748b' } },
          y: { beginAtZero: true, grid: { color: isDark ? '#334155' : '#f1f5f9' }, ticks: { font: { size: 10, family: 'Outfit' }, color: isDark ? '#94a3b8' : '#64748b' } }
        },
        animation: { duration: 900 }
      }
    });
  }

  // ── NEW: Line Chart ──────────────────────────────────────────────
  drawLineChart() {
    const canvas = document.getElementById('complianceLineChart') as HTMLCanvasElement;
    if (!canvas) return;
    if (this.lineChart) { this.lineChart.destroy(); this.lineChart = null; }
    const isDark = this.themeService.isDarkMode;

    // Need at least 2 points; pad with zeros if needed
    const history = this.complianceHistory.length >= 2
      ? this.complianceHistory
      : [
          { label: 'Start', done: 0, not_done: 0, in_progress: 0 },
          ...(this.complianceHistory.length === 1 ? this.complianceHistory : []),
          ...(this.globalStats ? [{ label: 'Now', done: this.globalStats.status.done, not_done: this.globalStats.status.not_done, in_progress: this.globalStats.status.in_progress }] : [])
        ];

    const labels = history.map(h => h.label);
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? '#334155' : '#f1f5f9';

    this.lineChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Pass',
            data: history.map(h => h.done),
            borderColor: this.colors.green,
            backgroundColor: this.colors.green + '20',
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: this.colors.green,
            borderWidth: 2,
          },
          {
            label: 'Fail',
            data: history.map(h => h.not_done),
            borderColor: this.colors.red,
            backgroundColor: this.colors.red + '15',
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: this.colors.red,
            borderWidth: 2,
          },
          {
            label: 'In Progress',
            data: history.map(h => h.in_progress),
            borderColor: this.colors.amber,
            backgroundColor: this.colors.amber + '15',
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: this.colors.amber,
            borderWidth: 2,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false  // we use custom pills in HTML
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: isDark ? '#1e293b' : '#fff',
            titleColor: isDark ? '#f8fafc' : '#1e293b',
            bodyColor: textColor,
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: (items) => `Snapshot: ${items[0].label}`,
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, family: 'Outfit' }, color: textColor }
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { font: { size: 10, family: 'Outfit' }, color: textColor }
          }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        animation: { duration: 1000 }
      }
    });
  }

  // ── NEW: Pie Chart ASVS Levels ───────────────────────────────────
  drawPieChart() {
    const canvas = document.getElementById('asvsLevelPieChart') as HTMLCanvasElement;
    if (!canvas) return;
    if (this.pieChart) { this.pieChart.destroy(); this.pieChart = null; }
    const isDark = this.themeService.isDarkMode;

    const l1Color = '#6366f1';  // indigo
    const l2Color = '#f59e0b';  // amber
    const l3Color = '#ef4444';  // red

    this.pieChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Level 1', 'Level 2', 'Level 3'],
        datasets: [{
          data: [this.levelStats.l1, this.levelStats.l2, this.levelStats.l3],
          backgroundColor: [l1Color + 'cc', l2Color + 'cc', l3Color + 'cc'],
          borderColor: [l1Color, l2Color, l3Color],
          borderWidth: 2,
          hoverOffset: 8,
        }]
      },
      plugins: [{
        id: 'centerText',
        afterDraw: (chart: any) => {
          const { ctx, chartArea: { top, bottom, left, right } } = chart;
          const cx = (left + right) / 2, cy = (top + bottom) / 2;
          const total = this.levelStats.l1 + this.levelStats.l2 + this.levelStats.l3;
          ctx.save();
          ctx.font = 'bold 20px Outfit';
          ctx.fillStyle = isDark ? '#f8fafc' : '#1e293b';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(total), cx, cy - 8);
          ctx.font = '11px Outfit';
          ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
          ctx.fillText('requirements', cx, cy + 10);
          ctx.restore();
        }
      }],
      options: {
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#fff',
            titleColor: isDark ? '#f8fafc' : '#1e293b',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const total = this.levelStats.l1 + this.levelStats.l2 + this.levelStats.l3;
                const pct = Math.round((ctx.parsed / total) * 100);
                return ` ${ctx.parsed} reqs (${pct}%)`;
              }
            }
          }
        },
        animation: { duration: 1000 }
      }
    });
  }

  // ── CRUD / Actions ───────────────────────────────────────────────
  createProject() {
    const input = this.newProjectName.trim();
    if (!input) return;
    this.creating = true;
    this.error = '';

    const githubRegex = /github\.com\/([^/]+)\/([^/]+)/;
    const match = input.match(githubRegex);
    let projectName = input;
    let githubUrl = '';

    if (match) {
      let repo = match[2];
      if (repo.endsWith('.git')) repo = repo.slice(0, -4);
      projectName = repo;
      githubUrl = input;
    }

    this.projectService.createProject(projectName).subscribe({
      next: (res: any) => {
        if (githubUrl && res.id) {
          this.projectService.updateProject(res.id, { github_url: githubUrl }).subscribe({
            next: () => { this.projectService.fetchGithubFiles(res.id).subscribe(); }
          });
        }
        this.newProjectName = '';
        this.creating = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.creating = false;
        this.error = err?.error?.error || 'Create failed';
        this.cdr.detectChanges();
      }
    });
  }

  exportAllPDF() {
    if (!this.globalStats) return;
    const doc = new jsPDF();
    const s = this.globalStats.status;
    const pct = this.globalStats.compliance_percent;

    doc.setFontSize(22); doc.setTextColor(99, 102, 241);
    doc.text('OWASP ASVS Compliance Report', 14, 22);
    doc.setFontSize(10); doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`Total Requirements: 284`, 14, 35);
    doc.setFontSize(16); doc.setTextColor(30, 41, 59);
    doc.text('Global Summary', 14, 50);

    const summaryData = [
      ['Status', 'Count', 'Percentage'],
      ['Pass', s.done, `${this.pct(s.done)}%`],
      ['Fail', s.not_done, `${this.pct(s.not_done)}%`],
      ['N/A', s.not_applicable, `${this.pct(s.not_applicable)}%`],
      ['Unreviewed', s.untested + s.in_progress, `${this.pct(s.untested + s.in_progress)}%`],
    ];

    autoTable(doc, { startY: 55, head: [summaryData[0]], body: summaryData.slice(1), theme: 'grid', headStyles: { fillColor: [99, 102, 241] } });

    const finalY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14); doc.text(`Overall Compliance Score: ${pct}%`, 14, finalY);
    doc.setFontSize(16); doc.text('Compliance by Category', 14, finalY + 15);

    autoTable(doc, {
      startY: finalY + 20,
      head: [['Category', 'Pass', 'Fail', 'N/A', 'Total', 'Compliance']],
      body: this.categoryStats.map(c => [c.name, c.done, c.fail, c.na, c.total, `${c.percent}%`]),
      theme: 'striped', headStyles: { fillColor: [79, 70, 229] },
    });

    doc.save('ASVS-Dashboard-Report.pdf');
  }

  logout(e: Event) {
    e.preventDefault();
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    this.router.navigate(['/login']);
  }

  openGithubModal(project: any, event: Event) {
    event.stopPropagation();
    this.selectedGithubProject = { ...project };
    this.showGithubModal = true;
    this.githubError = '';
    this.githubFilesCount = null;
  }

  closeGithubModal() {
    this.showGithubModal = false;
    this.selectedGithubProject = null;
    this.githubError = '';
    this.githubFilesCount = null;
  }

  saveGithubUrl() {
    if (!this.selectedGithubProject?.id) return;
    this.savingGithub = true;
    this.githubError = '';
    this.projectService.updateProject(this.selectedGithubProject.id, { github_url: this.selectedGithubProject.github_url }).subscribe({
      next: () => { this.savingGithub = false; },
      error: (err) => { this.savingGithub = false; this.githubError = err?.error?.error || 'Failed to save URL'; }
    });
  }

  fetchGithubFiles() {
    if (!this.selectedGithubProject?.id) return;
    this.fetchingGithub = true;
    this.githubError = '';
    this.githubFilesCount = null;
    this.projectService.fetchGithubFiles(this.selectedGithubProject.id).subscribe({
      next: (res) => { this.fetchingGithub = false; this.githubFilesCount = res.files?.length || 0; },
      error: (err) => { this.fetchingGithub = false; this.githubError = err?.error?.error || 'Failed to fetch files'; }
    });
  }

  ngOnDestroy() {
    this.donutChart?.destroy();
    this.barChart?.destroy();
    this.lineChart?.destroy();
    this.pieChart?.destroy();
  }
deleteProject(project: any, event: Event) {
  event.stopPropagation();
  if (!confirm(`Supprimer "${project.name}" ? Cette action est irréversible.`)) return;

  this.projectService.deleteProject(project.id).subscribe({
    next: () => {
      this.loadProjects();
    },
    error: (err) => {
      alert(err?.error?.error || 'Erreur lors de la suppression');
    }
  });
}
}