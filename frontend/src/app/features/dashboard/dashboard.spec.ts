// @vitest-environment jsdom
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { Dashboard } from './dashboard';
import { ProjectService } from '../../core/project.service';
import { RequirementService } from '../../core/requirement.service';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

describe('Dashboard', () => {
  let component: Dashboard;
  let fixture: ComponentFixture<Dashboard>;
  let projectServiceMock: any;
  let requirementServiceMock: any;

  beforeEach(async () => {
    (window as any)['Chart'] = class {
      constructor() { }
      destroy() { }
      update() { }
    };

    projectServiceMock = {
      projects$: of([]),
      refreshProjects: () => of([]),
      createProject: () => of({})
    };

    requirementServiceMock = {
      getStats: () => of(null)
    };

    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: RequirementService, useValue: requirementServiceMock },
        provideRouter([])
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
