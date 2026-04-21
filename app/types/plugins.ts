export interface PluginNavItem {
  id: string
  to: string
  label: string
  icon: string
  beta?: boolean
  requiresAdmin?: boolean
}

export interface PluginPageDefinition {
  title?: string
  component: () => Promise<any>
}

export interface PluginLocaleMessages {
  fr?: Record<string, any>
  en?: Record<string, any>
  de?: Record<string, any>
}

export interface PluginSettingsFieldDefinition {
  key: string
  label: string
  type?: 'text' | 'password'
  placeholder?: string
  description?: string
  required?: boolean
}

export interface PluginSettingsDefinition {
  fields: PluginSettingsFieldDefinition[]
}

export interface ClientPluginDefinition {
  id: string
  name?: string
  description?: string
  navigation?: PluginNavItem[]
  pages?: Record<string, PluginPageDefinition>
  i18n?: PluginLocaleMessages
  settings?: PluginSettingsDefinition
}
