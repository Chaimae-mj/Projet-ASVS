import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private api = 'http://localhost:5000';

  private projectsSubject = new BehaviorSubject<any[]>([]);
  projects$ = this.projectsSubject.asObservable();

  constructor(private http: HttpClient) {}

  /** call this to actually fetch from backend */
  refreshProjects(): Observable<any[]> {
    const headers = new HttpHeaders({
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    });

    const url = `${this.api}/projects?_=${Date.now()}`;

    return this.http.get<any[]>(url, { headers }).pipe(
      tap((res) => {
        this.projectsSubject.next(Array.isArray(res) ? res : []);
      })
    );
  }

  createProject(name: string) {
    return this.http.post(`${this.api}/projects`, { name }).pipe(
      tap(() => {
        // بعد create كنعاودو نrefreshيو اللائحة
        this.refreshProjects().subscribe();
      })
    );
  }
}