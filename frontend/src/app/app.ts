import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

import { NavbarComponent } from './core/components/navbar/navbar';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})

export class App {  }