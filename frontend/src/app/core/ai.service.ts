import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type AiLanguage =
  | 'java'
  | 'javascript'
  | 'python'
  | 'csharp'
  | 'php'
  | 'go'
  | 'kotlin';

export type AiSuggestResponse = {
  requirementId: string;
  language: string;

  summary: string;
  what_to_do: string[];
  evidence: string;

  files: string[];     // ✅ always array
  code: string;        // ✅ always string

  assumptions: string[];
  questions: string[];

  raw?: any;
};

export type AiSuggestRequest = {
  projectId: string;
  requirementId: string;
  title: string;
  requirementText?: string;
  area?: string;
  cwe?: string;
  level?: string | number;
  language: AiLanguage;
};

@Injectable({ providedIn: 'root' })
export class AiService {
  private api = 'http://localhost:5000';

  constructor(private http: HttpClient) {}

  // (اختياري) خليه إذا باقي كتستعمله
  generate(body: AiSuggestRequest): Observable<AiSuggestResponse> {
    return this.http.post<AiSuggestResponse>(`${this.api}/ai/generate`, body);
  }

  // ✅ هذا هو اللي كتستعمله checklist
  suggest(body: AiSuggestRequest): Observable<AiSuggestResponse> {
    return this.http.post<AiSuggestResponse>(`${this.api}/ai/suggest`, body);
  }
}