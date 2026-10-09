import { SupabaseDataService } from './supabaseData'
import { SupabaseAuthService } from './supabaseAuth'
import type { AuthService, DataService } from './types'

export const authService: AuthService = new SupabaseAuthService()
export const dataService: DataService = new SupabaseDataService()
