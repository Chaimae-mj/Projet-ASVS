import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type RequirementProgress = {
  requirement_id?: string;
  applicability: 'YES' | 'NO' | 'NA';
  status: 'UNTESTED' | 'DONE' | 'IN_PROGRESS' | 'NOT_DONE' | 'NOT_APPLICABLE';
  comment: string;
  tool_used: string;
  source_code_reference: string;
};

export type AsvsRequirement = {
  '#': string;
  'Verification Requirement': string;
  'Area'?: string;
  'CWE'?: string | number;
  'ASVS Level'?: string | number;

  // merged from DB
  progress: RequirementProgress;
};

export type ProjectStats = {
  total: number;
  applicable: number;
  excluded: { no: number; na: number };
  status: {
    done: number;
    in_progress: number;
    not_done: number;
    not_applicable: number;
    untested: number;
  };
  compliance_percent: number;
};

@Injectable({ providedIn: 'root' })
export class RequirementService {
  private api = 'http://localhost:5000';

  constructor(private http: HttpClient) {}

  // ✅ GET merged checklist
  getChecklist(projectId: string): Observable<AsvsRequirement[]> {
    return this.http.get<AsvsRequirement[]>(`${this.api}/projects/${projectId}/requirements`);
  }

  // ✅ PATCH progress
  updateRequirement(projectId: string, reqId: string, body: Partial<RequirementProgress>): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.api}/projects/${projectId}/requirements/${reqId}`, body);
  }

  // ✅ GET stats
  getStats(projectId: string): Observable<ProjectStats> {
    return this.http.get<ProjectStats>(`${this.api}/projects/${projectId}/stats`);
  }
}