import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type RequirementProgress = {
  requirement_id?: string;
  applicability: 'YES' | 'NO' | 'NA';
  status: 'UNTESTED' | 'DONE' | 'IN_PROGRESS' | 'NOT_DONE' | 'NOT_APPLICABLE';
  comment: string;
  admin_comment: string;
  admin_reply: string;
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
  categories: Record<string, {
    total: number;
    done: number;
    not_done: number;
    in_progress: number;
    untested: number;
    not_applicable: number;
    compliance: number
  }>;
};

@Injectable({ providedIn: 'root' })
export class RequirementService {
  //private api = 'http://localhost:5000';
private api = environment.apiUrl;
  constructor(private http: HttpClient) { }

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