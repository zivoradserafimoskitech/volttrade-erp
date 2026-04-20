export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_type: string
          created_at: string
          fixed_price_eur_mwh: number | null
          id: string
          margin_eur_mwh: number
          status: string
          tax_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_type?: string
          created_at?: string
          fixed_price_eur_mwh?: number | null
          id?: string
          margin_eur_mwh?: number
          status?: string
          tax_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_type?: string
          created_at?: string
          fixed_price_eur_mwh?: number | null
          id?: string
          margin_eur_mwh?: number
          status?: string
          tax_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consumption_readings: {
        Row: {
          actual_mwh: number | null
          created_at: string
          forecast_mwh: number | null
          id: string
          metering_point_id: string
          reading_at: string
        }
        Insert: {
          actual_mwh?: number | null
          created_at?: string
          forecast_mwh?: number | null
          id?: string
          metering_point_id: string
          reading_at: string
        }
        Update: {
          actual_mwh?: number | null
          created_at?: string
          forecast_mwh?: number | null
          id?: string
          metering_point_id?: string
          reading_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumption_readings_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_id: string
          created_at: string
          energy_amount_eur: number
          id: string
          invoice_number: string
          margin_amount_eur: number
          period_end: string
          period_start: string
          status: string
          total_eur: number
          total_mwh: number
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          energy_amount_eur?: number
          id?: string
          invoice_number: string
          margin_amount_eur?: number
          period_end: string
          period_start: string
          status?: string
          total_eur?: number
          total_mwh?: number
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          energy_amount_eur?: number
          id?: string
          invoice_number?: string
          margin_amount_eur?: number
          period_end?: string
          period_start?: string
          status?: string
          total_eur?: number
          total_mwh?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      market_prices: {
        Row: {
          created_at: string
          delivery_at: string
          id: string
          price_eur_mwh: number
        }
        Insert: {
          created_at?: string
          delivery_at: string
          id?: string
          price_eur_mwh: number
        }
        Update: {
          created_at?: string
          delivery_at?: string
          id?: string
          price_eur_mwh?: number
        }
        Relationships: []
      }
      metering_points: {
        Row: {
          address: string | null
          annual_consumption_mwh: number | null
          client_id: string
          created_at: string
          edu_code: string
          id: string
          voltage_level: string | null
        }
        Insert: {
          address?: string | null
          annual_consumption_mwh?: number | null
          client_id: string
          created_at?: string
          edu_code: string
          id?: string
          voltage_level?: string | null
        }
        Update: {
          address?: string | null
          annual_consumption_mwh?: number | null
          client_id?: string
          created_at?: string
          edu_code?: string
          id?: string
          voltage_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metering_points_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nominations: {
        Row: {
          balancing_cost_eur: number
          counterparty: string | null
          created_at: string
          id: string
          notes: string | null
          price_eur_mwh: number
          side: string
          trade_date: string
          user_id: string
          volume_mwh: number
        }
        Insert: {
          balancing_cost_eur?: number
          counterparty?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          price_eur_mwh: number
          side: string
          trade_date: string
          user_id: string
          volume_mwh: number
        }
        Update: {
          balancing_cost_eur?: number
          counterparty?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          price_eur_mwh?: number
          side?: string
          trade_date?: string
          user_id?: string
          volume_mwh?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
