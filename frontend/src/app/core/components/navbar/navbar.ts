import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { LanguageService } from '../../services/language.service';

@Component({
    selector: 'app-navbar',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './navbar.html',
    styleUrl: './navbar.scss'
})
export class NavbarComponent {
    constructor(
        private router: Router,
        private location: Location,
        public themeService: ThemeService,
        public langService: LanguageService
    ) { }

    get rawRole(): string {
        return (localStorage.getItem('role') || 'Guest').toUpperCase();
    }

    isAdmin(): boolean {
        const r = this.rawRole;
        return r === 'ADMIN' || r === 'ADMINISTRATEUR';
    }

    get userRole() {
        return this.langService.translate(this.rawRole);
    }

    t(key: string) {
        return this.langService.translate(key);
    }

    goBack() {
        this.location.back();
    }

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        this.router.navigate(['/login']);
    }

    isLoggedIn(): boolean {
        return !!localStorage.getItem('token');
    }
}
