// config.component.ts
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { ConfigData, ModelOption, SaveResponse } from '@lib/utils/storage/storage.types';
import { BackendService } from '@lib/services';
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
    };

    originalConfig: ConfigData = { ...this.config };
    isLoading = false;
    isSaving = false;
    isRestarting = false;
    message = '';
    messageType = '';
    showPassword = false;
    showApiKey = false;

    supportedModels: ModelOption[] = [
        {
            provider: 'Gemini',
            models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        },
        {
            provider: 'OpenAI',
            models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4o'],
        },
        {
            provider: 'Anthropic',
            models: ['claude-opus-4-1', 'claude-opus-4', 'claude-sonnet-4', 'claude-3-7-sonnet', 'claude-3-5-haiku'],
        },
        {
            provider: 'Mistral',
            models: ['mistral-medium-2508', 'mistral-large-2411', 'mistral-small-2407', 'codestral-2508'],
        },
        {
            provider: 'Cohere',
            models: [
                'command-a-03-2025',
                'command-a-reasoning-08-2025',
                'command-a-vision-07-2025',
                'command-r7b-12-2024',
            ],
        },
        {
            provider: 'HuggingFace',
            models: [
                'meta-llama/Llama-3.1-8B-Instruct',
                'meta-llama/Llama-3.1-70B-Instruct',
                'Qwen/Qwen2.5-7B-Instruct',
            ],
        },
        {
            provider: 'Perplexity',
            models: ['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research'],
        },
    ];

    constructor(
        private backendService: BackendService,
        private router: Router,
        private location: Location,
    ) {}

    ngOnInit() {
        this.loadConfig();
    }

    loadConfig() {
        this.isLoading = true;
        this.backendService.getConfigData().subscribe({
            next: (data) => {
                this.config = { ...data };
                this.originalConfig = { ...data };
                this.isLoading = false;
                console.log('Config loaded:', this.config);
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

        const portChanged = this.config.PORT !== this.originalConfig.PORT;

        this.isSaving = true;
        this.backendService.updateConfigData(this.config).subscribe({
            next: (response) => {
                this.originalConfig = { ...this.config };
                this.showMessage(response.message, 'success');
                this.isSaving = false;

                if (response.requiresRestart && response.newPort) {
                    this.handleServerRestart(response.newPort);
                }
            },
            error: (error) => {
                console.error('Error saving config:', error);
                this.showMessage('Error saving configuration', 'error');
                this.isSaving = false;
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
}
