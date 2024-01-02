import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { get } from 'lodash';

// Define the expected configuration types
interface AppConfig {
    // Define your expected configuration properties here
    secretone: {
        pass: string;
        api: string;
        client: string;
        user: string;
    };
    firebase: {

    };
    // ...
}

let config: AppConfig;

// Function to read the YAML configuration file
function readConfigFile(): AppConfig | null {
    try {
        const configContent = fs.readFileSync('config.yaml', 'utf8');
        return yaml.load(configContent) as AppConfig;
    } catch (error: any) {
        console.error('Error reading config file:', error.message);
        return null;
    }
}

// Function to create a default configuration file
function createDefaultConfigFile(): void {
    const defaultConfig: AppConfig = {
        secretone: {
            client: "client_id",
            api: "client_api_key",
            user: "puppet_username",
            pass: "puppet_password",
        },
        firebase: {},
        // ...
    };

    try {
        const yamlContent = yaml.dump(defaultConfig);
        fs.writeFileSync('config.yaml', yamlContent, 'utf8');
        console.log('Default config file created.');
    } catch (error: any) {
        console.error('Error creating default config file:', error.message);
    }
}

// Main function to get the configuration
export function load(): AppConfig {
    const existingConfig = readConfigFile();

    if (existingConfig) {
        console.log('Using existing config file.');
        return existingConfig;
    } else {
        console.log('Config file not found. Creating a default config file.');
        createDefaultConfigFile();
        // Retry reading the config file after creation
        const config = readConfigFile();

        if (!config) {
            process.exit(1);
        }
        else return config;
    }
}

export function getConfig(path: string): any {
    if (!config) throw new Error('Config not loaded');
    return get(config, path);
}

