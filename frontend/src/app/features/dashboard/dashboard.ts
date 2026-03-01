import { Component, OnInit, OnDestroy, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ProjectService } from '../../core/project.service';
import { RequirementService, ProjectStats } from '../../core/requirement.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

declare const Chart: any;

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard implements OnInit, OnDestroy, AfterViewInit {
  projects: any[] = [];
  newProjectName = '';
  loading = false;
  creating = false;
  error = '';

  // Stats
  globalStats: ProjectStats | null = null;
  projectStatsMap: Record<string, ProjectStats> = {};

  // Charts instances
  private donutChart: any = null;
  private barChart: any = null;
  private statusChart: any = null;

  // Colors palette
  private colors = {
    green:  '#22c55e',
    blue:   '#3b82f6',
    orange: '#f97316',
    red:    '#ef4444',
    gray:   '#94a3b8',
    purple: '#a855f7',
  };

  constructor(
    private projectService: ProjectService,
    private requirementService: RequirementService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.projectService.projects$.subscribe((list) => {
      this.projects = list || [];
      this.loading = false;
      this.cdr.detectChanges();
      if (this.projects.length > 0) {
        this.loadAllStats();
      }
    });
    this.loadProjects();
  }

  ngAfterViewInit(): void {}

  loadProjects() {
    this.loading = true;
    this.error = '';
    this.cdr.detectChanges();

    this.projectService.refreshProjects().subscribe({
      next: () => {},
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || err?.message || 'Failed to load projects';
        this.cdr.detectChanges();
      }
    });
  }

  loadAllStats() {
    if (!this.projects.length) return;

    const statsCalls = this.projects.map(p =>
      this.requirementService.getStats(p.id).pipe(catchError(() => of(null)))
    );

    forkJoin(statsCalls).subscribe((results) => {
      const statsMap: Record<string, ProjectStats> = {};
      let totalDone = 0, totalInProgress = 0, totalNotDone = 0, totalUntested = 0;
      let totalApplicable = 0, totalNotApplicable = 0;
      let totalReqs = 0;

      results.forEach((stats, i) => {
        if (stats && this.projects[i]) {
          statsMap[this.projects[i].id] = stats;
          totalDone         += stats.status.done;
          totalInProgress   += stats.status.in_progress;
          totalNotDone      += stats.status.not_done;
          totalUntested     += stats.status.untested;
          totalApplicable   += stats.applicable;
          totalNotApplicable+= stats.status.not_applicable;
          totalReqs         += stats.total;
        }
      });

      this.projectStatsMap = statsMap;
      const compliance = totalApplicable === 0 ? 0 : Math.round((totalDone / totalApplicable) * 100);

      this.globalStats = {
        total: totalReqs,
        applicable: totalApplicable,
        excluded: { no: 0, na: 0 },
        status: {
          done: totalDone,
          in_progress: totalInProgress,
          not_done: totalNotDone,
          not_applicable: totalNotApplicable,
          untested: totalUntested,
        },
        compliance_percent: compliance,
      };

      this.cdr.detectChanges();

      // Draw charts after data is ready + DOM updated
      setTimeout(() => this.initCharts(), 100);
    });
  }

  initCharts() {
    this.destroyCharts();
    this.drawDonut();
    this.drawBar();
    this.drawStatus();
  }

  destroyCharts() {
    if (this.donutChart)  { this.donutChart.destroy();  this.donutChart  = null; }
    if (this.barChart)    { this.barChart.destroy();    this.barChart    = null; }
    if (this.statusChart) { this.statusChart.destroy(); this.statusChart = null; }
  }

  drawDonut() {
    const canvas = document.getElementById('donutChart') as HTMLCanvasElement;
    if (!canvas || !this.globalStats) return;
    const s = this.globalStats.status;

    this.donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Done', 'In Progress', 'Not Done', 'Untested'],
        datasets: [{
          data: [s.done, s.in_progress, s.not_done, s.untested],
          backgroundColor: [this.colors.green, this.colors.blue, this.colors.orange, this.colors.gray],
          borderWidth: 3,
          borderColor: '#fff',
          hoverOffset: 8,
        }]
      },
      options: {
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => ` ${ctx.label}: ${ctx.parsed} req(s)`
            }
          }
        },
        animation: { animateRotate: true, duration: 1200 }
      }
    });

    // Center text plugin
    const total = this.globalStats.compliance_percent;
    const plugin = {
      id: 'centerText',
      afterDraw(chart: any) {
        const { ctx, chartArea: { top, bottom, left, right } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        ctx.save();
        ctx.font = 'bold 28px system-ui';
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${total}%`, cx, cy - 8);
        ctx.font = '12px system-ui';
        ctx.fillStyle = '#64748b';
        ctx.fillText('compliance', cx, cy + 16);
        ctx.restore();
      }
    };
    this.donutChart.options.plugins.centerText = {};
    Chart.register(plugin);
    this.donutChart.update();
  }

  drawBar() {
    const canvas = document.getElementById('barChart') as HTMLCanvasElement;
    if (!canvas) return;

    const labels = this.projects.map(p => p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name);
    const compliance = this.projects.map(p => this.projectStatsMap[p.id]?.compliance_percent ?? 0);
    const done       = this.projects.map(p => this.projectStatsMap[p.id]?.status.done ?? 0);
    const inProg     = this.projects.map(p => this.projectStatsMap[p.id]?.status.in_progress ?? 0);

    this.barChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Done',
            data: done,
            backgroundColor: this.colors.green + 'cc',
            borderRadius: 6,
            borderSkipped: false,
          },
          {
            label: 'In Progress',
            data: inProg,
            backgroundColor: this.colors.blue + 'cc',
            borderRadius: 6,
            borderSkipped: false,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, padding: 16, font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              afterBody: (items: any[]) => {
                const idx = items[0]?.dataIndex;
                const pct = this.projects[idx] ? (this.projectStatsMap[this.projects[idx].id]?.compliance_percent ?? 0) : 0;
                return [`Compliance: ${pct}%`];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 11 } }
          }
        },
        animation: { duration: 1000 }
      }
    });
  }

  drawStatus() {
    const canvas = document.getElementById('statusChart') as HTMLCanvasElement;
    if (!canvas || !this.globalStats) return;
    const s = this.globalStats.status;
    const total = s.done + s.in_progress + s.not_done + s.untested + s.not_applicable || 1;

    this.statusChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Requirements'],
        datasets: [
          { label: 'Done',           data: [s.done],           backgroundColor: this.colors.green,  borderRadius: 4 },
          { label: 'In Progress',    data: [s.in_progress],    backgroundColor: this.colors.blue,   borderRadius: 4 },
          { label: 'Not Done',       data: [s.not_done],       backgroundColor: this.colors.orange, borderRadius: 4 },
          { label: 'Untested',       data: [s.untested],       backgroundColor: this.colors.gray,   borderRadius: 4 },
          { label: 'Not Applicable', data: [s.not_applicable], backgroundColor: this.colors.purple, borderRadius: 4 },
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 14, font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.x} (${Math.round(ctx.parsed.x / total * 100)}%)`
            }
          }
        },
        scales: {
          x: { stacked: true, display: false },
          y: { stacked: true, display: false }
        },
        animation: { duration: 1200 }
      }
    });
  }

  createProject() {
    if (!this.newProjectName.trim()) return;
    this.creating = true;
    this.error = '';

    this.projectService.createProject(this.newProjectName.trim()).subscribe({
      next: () => {
        this.newProjectName = '';
        this.creating = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.creating = false;
        this.error = err?.error?.error || err?.message || 'Create failed';
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }
}