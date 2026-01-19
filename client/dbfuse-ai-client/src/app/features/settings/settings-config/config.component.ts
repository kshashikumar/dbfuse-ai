// config.component.ts
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { ConfigData, ModelOption, SaveResponse } from '@core/utils/storage/storage.types';
import { BackendService } from '@core/services/backend/backend.service';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-config',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './config.component.html',
})
export class ConfigComponent implements OnInit {
    config: ConfigData = {
        AI_MODEL: '',
        AI_API_KEY: '',
        AI_PROVIDER: '',
        PORT: 5000,
        DBFUSE_USERNAME: '',
        DBFUSE_PASSWORD: '',
        DBFUSE_CONNECTIONS_KEY: '',
    };

    originalConfig: ConfigData = { ...this.config };
    isLoading = false;
    isSaving = false;
    isRestarting = false;
    message = '';
    messageType = '';
    showPassword = false;
    showApiKey = false;
    showConnectionsKey = false;
    pendingConnectionsReset = false;

    supportedModels: ModelOption[] = [];

    constructor(
        private backendService: BackendService,
        private router: Router,
        private location: Location,
    ) {}

    ngOnInit() {
        this.loadConfig();
        this.loadModelCatalog();
    }

    loadModelCatalog() {
        this.backendService.getAIModelCatalog().subscribe({
            next: (data) => {
                this.supportedModels = data?.providers || [];
            },
            error: (error) => {
                console.warn('Failed to load AI model catalog.', error);
                this.supportedModels = [];
                this.showMessage('Failed to load AI model catalog', 'error');
            },
        });
    }

    loadConfig() {
        this.isLoading = true;
        this.backendService.getConfigData().subscribe({
            next: (data) => {
                const normalized = {
                    ...data,
                    DBFUSE_CONNECTIONS_KEY: data.DBFUSE_CONNECTIONS_KEY || '',
                };
                this.config = { ...normalized };
                this.originalConfig = { ...normalized };
                this.isLoading = false;
            },
            error: (error) => {
                console.error('Error loading config:', error);
                this.showMessage('Failed to load configuration', 'error');
                this.isLoading = false;
            },
        });
    }

    saveConfig() {
        if (!this.validateConfig()) {
            return;
        }

        const keyWasSet = (this.originalConfig.DBFUSE_CONNECTIONS_KEY || '').trim().length > 0;
        const keyIsNowEmpty = !(this.config.DBFUSE_CONNECTIONS_KEY || '').trim().length;
        const removingKey = keyWasSet && keyIsNowEmpty;

        if (removingKey) {
            const confirmed = window.confirm(
                'Removing the encryption key will delete all saved connections. This cannot be undone. Continue?',
            );
            if (!confirmed) {
                return;
            }
        }

        this.pendingConnectionsReset = removingKey;

        const portChanged = this.config.PORT !== this.originalConfig.PORT;

        this.isSaving = true;
        this.backendService.updateConfigData(this.config).subscribe({
            next: (response) => {
                this.originalConfig = { ...this.config };
                const suffix =
                    response.connectionsCleared || this.pendingConnectionsReset
                        ? ' Saved connections were deleted because the encryption key was removed.'
                        : '';
                this.showMessage(`${response.message}${suffix}`, 'success');
                this.isSaving = false;
                this.pendingConnectionsReset = false;

                if (response.requiresRestart && response.newPort) {
                    this.handleServerRestart(response.newPort);
                }
            },
            error: (error) => {
                console.error('Error saving config:', error);
                this.showMessage('Error saving configuration', 'error');
                this.isSaving = false;
                this.pendingConnectionsReset = false;
            },
        });
    }

    handleServerRestart(newPort: number) {
        this.isRestarting = true;
        this.showMessage('Server is restarting with new port...', 'info');

        setTimeout(() => {
            const currentHost = window.location.hostname;
            const newUrl = `http://${currentHost}:${newPort}${window.location.pathname}`;

            let countdown = 5;
            const countdownInterval = setInterval(() => {
                this.showMessage(`Redirecting to new port in ${countdown} seconds...`, 'info');
                countdown--;

                if (countdown < 0) {
                    clearInterval(countdownInterval);
                    window.location.href = newUrl;
                }
            }, 1000);
        }, 2000);
    }

    resetConfig() {
        this.config = { ...this.originalConfig };
        this.showMessage('Configuration reset to last saved values', 'info');
    }

    onProviderChange() {
        this.config.AI_MODEL = '';
    }

    getModelsForProvider(): string[] {
        const provider = this.supportedModels.find((p) => p.provider === this.config.AI_PROVIDER);
        return provider ? provider.models : [];
    }

    validateConfig(): boolean {
        if (this.config.PORT < 1000 || this.config.PORT > 65535) {
            this.showMessage('Port must be between 1000 and 65535', 'error');
            return false;
        }

        if (!this.config.DBFUSE_USERNAME.trim()) {
            this.showMessage('Database username is required', 'error');
            return false;
        }

        return true;
    }

    hasChanges(): boolean {
        return JSON.stringify(this.config) !== JSON.stringify(this.originalConfig);
    }

    showMessage(text: string, type: string) {
        this.message = text;
        this.messageType = type;

        setTimeout(() => {
            this.message = '';
            this.messageType = '';
        }, 3000);
    }

    goBack() {
        this.location.back();
    }

    togglePasswordVisibility() {
        this.showPassword = !this.showPassword;
    }

    toggleApiKeyVisibility() {
        this.showApiKey = !this.showApiKey;
    }

    toggleConnectionsKeyVisibility() {
        this.showConnectionsKey = !this.showConnectionsKey;
    }
}
