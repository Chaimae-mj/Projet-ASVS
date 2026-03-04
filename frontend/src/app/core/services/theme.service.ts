import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private theme = signal<'light' | 'dark'>('light');

    constructor() {
        const saved = localStorage.getItem('theme') as 'light' | 'dark';
        if (saved) {
            this.setTheme(saved);
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this.setTheme('dark');
        }
    }

    get currentTheme() {
        return this.theme();
    }

    get isDarkMode() {
        return this.theme() === 'dark';
    }

    setTheme(newTheme: 'light' | 'dark') {
        this.theme.set(newTheme);
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    }

    toggleTheme() {
        this.setTheme(this.theme() === 'light' ? 'dark' : 'light');
    }
}
