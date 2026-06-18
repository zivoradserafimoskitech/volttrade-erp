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
      audit_log: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: string
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      billing_runs: {
        Row: {
          created_at: string
          id: string
          invoice_count: number
          notes: string | null
          period_end: string
          period_start: string
          scope: string
          scope_id: string | null
          status: string
          total_eur: number
          total_mwh: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_count?: number
          notes?: string | null
          period_end: string
          period_start: string
          scope?: string
          scope_id?: string | null
          status?: string
          total_eur?: number
          total_mwh?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_count?: number
          notes?: string | null
          period_end?: string
          period_start?: string
          scope?: string
          scope_id?: string | null
          status?: string
          total_eur?: number
          total_mwh?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          city: string | null
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_type: string
          country_code: string | null
          created_at: string
          credit_limit_eur: number
          customer_category: string
          fixed_price_eur_mwh: number | null
          id: string
          margin_eur_mwh: number
          notes: string | null
          payment_terms_days: number
          status: string
          tax_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_type?: string
          country_code?: string | null
          created_at?: string
          credit_limit_eur?: number
          customer_category?: string
          fixed_price_eur_mwh?: number | null
          id?: string
          margin_eur_mwh?: number
          notes?: string | null
          payment_terms_days?: number
          status?: string
          tax_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_type?: string
          country_code?: string | null
          created_at?: string
          credit_limit_eur?: number
          customer_category?: string
          fixed_price_eur_mwh?: number | null
          id?: string
          margin_eur_mwh?: number
          notes?: string | null
          payment_terms_days?: number
          status?: string
          tax_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
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
      counterparties: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country_code: string | null
          created_at: string
          credit_limit_eur: number
          eic_code: string | null
          id: string
          legal_name: string
          notes: string | null
          payment_terms_days: number
          risk_status: string
          short_name: string | null
          status: string
          updated_at: string
          user_id: string
          vat_number: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          credit_limit_eur?: number
          eic_code?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          payment_terms_days?: number
          risk_status?: string
          short_name?: string | null
          status?: string
          updated_at?: string
          user_id: string
          vat_number?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          credit_limit_eur?: number
          eic_code?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          payment_terms_days?: number
          risk_status?: string
          short_name?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counterparties_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          created_at: string
          currency: string
          name: string
          tso_code: string | null
          vat_percent: number
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string
          name: string
          tso_code?: string | null
          vat_percent?: number
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          name?: string
          tso_code?: string | null
          vat_percent?: number
        }
        Relationships: []
      }
      forecasts: {
        Row: {
          budget_eur: number | null
          budget_mwh: number | null
          client_id: string
          created_at: string
          external_source: string | null
          external_synced_at: string | null
          forecast_date: string
          forecast_mwh: number
          forecast_mwh_external: number | null
          id: string
          method: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_eur?: number | null
          budget_mwh?: number | null
          client_id: string
          created_at?: string
          external_source?: string | null
          external_synced_at?: string | null
          forecast_date: string
          forecast_mwh?: number
          forecast_mwh_external?: number | null
          id?: string
          method?: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_eur?: number | null
          budget_mwh?: number | null
          client_id?: string
          created_at?: string
          external_source?: string | null
          external_synced_at?: string | null
          forecast_date?: string
          forecast_mwh?: number
          forecast_mwh_external?: number | null
          id?: string
          method?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          billing_run_id: string | null
          client_id: string
          components: Json
          created_at: string
          currency: string
          doc_type: string
          due_date: string | null
          energy_amount_eur: number
          id: string
          invoice_number: string
          margin_amount_eur: number
          paid_amount_eur: number
          period_end: string
          period_start: string
          status: string
          tax_amount_eur: number
          total_eur: number
          total_mwh: number
          user_id: string
        }
        Insert: {
          billing_run_id?: string | null
          client_id: string
          components?: Json
          created_at?: string
          currency?: string
          doc_type?: string
          due_date?: string | null
          energy_amount_eur?: number
          id?: string
          invoice_number: string
          margin_amount_eur?: number
          paid_amount_eur?: number
          period_end: string
          period_start: string
          status?: string
          tax_amount_eur?: number
          total_eur?: number
          total_mwh?: number
          user_id: string
        }
        Update: {
          billing_run_id?: string | null
          client_id?: string
          components?: Json
          created_at?: string
          currency?: string
          doc_type?: string
          due_date?: string | null
          energy_amount_eur?: number
          id?: string
          invoice_number?: string
          margin_amount_eur?: number
          paid_amount_eur?: number
          period_end?: string
          period_start?: string
          status?: string
          tax_amount_eur?: number
          total_eur?: number
          total_mwh?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
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
      meter_readings: {
        Row: {
          created_at: string
          created_by: string | null
          export_kwh: number
          id: string
          import_kwh: number
          metering_point_id: string
          notes: string | null
          reading_at: string
          source: string
          validated_at: string | null
          validated_by: string | null
          validation_status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          export_kwh?: number
          id?: string
          import_kwh?: number
          metering_point_id: string
          notes?: string | null
          reading_at: string
          source?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          export_kwh?: number
          id?: string
          import_kwh?: number
          metering_point_id?: string
          notes?: string | null
          reading_at?: string
          source?: string
          validated_at?: string | null
          validated_by?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meter_readings_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      metering_points: {
        Row: {
          address: string | null
          annual_consumption_mwh: number | null
          capacity_kw: number | null
          client_id: string
          connected_power_kw: number | null
          connection_type: string | null
          consumer_category: string
          created_at: string
          dso_area: string | null
          edu_code: string
          id: string
          meter_id: string | null
          notes: string | null
          slp_profile_code: string | null
          status: string
          voltage_level: string | null
        }
        Insert: {
          address?: string | null
          annual_consumption_mwh?: number | null
          capacity_kw?: number | null
          client_id: string
          connected_power_kw?: number | null
          connection_type?: string | null
          consumer_category?: string
          created_at?: string
          dso_area?: string | null
          edu_code: string
          id?: string
          meter_id?: string | null
          notes?: string | null
          slp_profile_code?: string | null
          status?: string
          voltage_level?: string | null
        }
        Update: {
          address?: string | null
          annual_consumption_mwh?: number | null
          capacity_kw?: number | null
          client_id?: string
          connected_power_kw?: number | null
          connection_type?: string | null
          consumer_category?: string
          created_at?: string
          dso_area?: string | null
          edu_code?: string
          id?: string
          meter_id?: string | null
          notes?: string | null
          slp_profile_code?: string | null
          status?: string
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
          {
            foreignKeyName: "metering_points_slp_profile_code_fkey"
            columns: ["slp_profile_code"]
            isOneToOne: false
            referencedRelation: "slp_profiles"
            referencedColumns: ["code"]
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
      payment_allocations: {
        Row: {
          amount_eur: number
          created_at: string
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          amount_eur: number
          created_at?: string
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          amount_eur?: number
          created_at?: string
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_eur: number
          bank_reference: string | null
          client_id: string
          created_at: string
          currency: string
          id: string
          method: string
          notes: string | null
          paid_at: string
          status: string
          user_id: string
        }
        Insert: {
          amount_eur: number
          bank_reference?: string | null
          client_id: string
          created_at?: string
          currency?: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          status?: string
          user_id: string
        }
        Update: {
          amount_eur?: number
          bank_reference?: string | null
          client_id?: string
          created_at?: string
          currency?: string
          id?: string
          method?: string
          notes?: string | null
          paid_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_lines: {
        Row: {
          created_at: string
          direction: string
          hour: number
          id: string
          schedule_id: string
          trade_id: string | null
          volume_mwh: number
        }
        Insert: {
          created_at?: string
          direction?: string
          hour: number
          id?: string
          schedule_id: string
          trade_id?: string | null
          volume_mwh?: number
        }
        Update: {
          created_at?: string
          direction?: string
          hour?: number
          id?: string
          schedule_id?: string
          trade_id?: string | null
          volume_mwh?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_lines_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_lines_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          delivery_date: string
          id: string
          message_log: Json
          notes: string | null
          response_at: string | null
          schedule_number: string
          status: string
          submitted_at: string | null
          tso_area: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          delivery_date: string
          id?: string
          message_log?: Json
          notes?: string | null
          response_at?: string | null
          schedule_number: string
          status?: string
          submitted_at?: string | null
          tso_area: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          delivery_date?: string
          id?: string
          message_log?: Json
          notes?: string | null
          response_at?: string | null
          schedule_number?: string
          status?: string
          submitted_at?: string | null
          tso_area?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      slp_curve_points: {
        Row: {
          day_type: string
          factor: number
          hour: number
          profile_code: string
          season: string
        }
        Insert: {
          day_type: string
          factor: number
          hour: number
          profile_code: string
          season: string
        }
        Update: {
          day_type?: string
          factor?: number
          hour?: number
          profile_code?: string
          season?: string
        }
        Relationships: [
          {
            foreignKeyName: "slp_curve_points_profile_code_fkey"
            columns: ["profile_code"]
            isOneToOne: false
            referencedRelation: "slp_profiles"
            referencedColumns: ["code"]
          },
        ]
      }
      slp_profiles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          name?: string
        }
        Relationships: []
      }
      supply_contract_points: {
        Row: {
          contract_id: string
          metering_point_id: string
        }
        Insert: {
          contract_id: string
          metering_point_id: string
        }
        Update: {
          contract_id?: string
          metering_point_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_contract_points_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "supply_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_contract_points_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_contracts: {
        Row: {
          annual_volume_mwh: number | null
          auto_renew: boolean
          client_id: string
          contract_number: string
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          payment_terms_days: number
          start_date: string
          status: string
          tariff_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          annual_volume_mwh?: number | null
          auto_renew?: boolean
          client_id: string
          contract_number: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          payment_terms_days?: number
          start_date: string
          status?: string
          tariff_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          annual_volume_mwh?: number | null
          auto_renew?: boolean
          client_id?: string
          contract_number?: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          payment_terms_days?: number
          start_date?: string
          status?: string
          tariff_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_contracts_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      tariffs: {
        Row: {
          code: string
          components: Json
          created_at: string
          currency: string
          customer_segment: string | null
          id: string
          model: string
          name: string
          notes: string | null
          status: string
          updated_at: string
          user_id: string
          valid_from: string
          valid_to: string | null
          vat_included: boolean
        }
        Insert: {
          code: string
          components?: Json
          created_at?: string
          currency?: string
          customer_segment?: string | null
          id?: string
          model?: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
          valid_from: string
          valid_to?: string | null
          vat_included?: boolean
        }
        Update: {
          code?: string
          components?: Json
          created_at?: string
          currency?: string
          customer_segment?: string | null
          id?: string
          model?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_to?: string | null
          vat_included?: boolean
        }
        Relationships: []
      }
      trades: {
        Row: {
          counterparty_id: string | null
          created_at: string
          delivery_end: string
          delivery_start: string
          hub: string | null
          id: string
          market: string
          notes: string | null
          price_eur_mwh: number
          side: string
          status: string
          total_value_eur: number | null
          trade_number: string
          trader: string | null
          trading_contract_id: string | null
          updated_at: string
          user_id: string
          volume_mwh: number
        }
        Insert: {
          counterparty_id?: string | null
          created_at?: string
          delivery_end: string
          delivery_start: string
          hub?: string | null
          id?: string
          market?: string
          notes?: string | null
          price_eur_mwh: number
          side: string
          status?: string
          total_value_eur?: number | null
          trade_number: string
          trader?: string | null
          trading_contract_id?: string | null
          updated_at?: string
          user_id: string
          volume_mwh: number
        }
        Update: {
          counterparty_id?: string | null
          created_at?: string
          delivery_end?: string
          delivery_start?: string
          hub?: string | null
          id?: string
          market?: string
          notes?: string | null
          price_eur_mwh?: number
          side?: string
          status?: string
          total_value_eur?: number | null
          trade_number?: string
          trader?: string | null
          trading_contract_id?: string | null
          updated_at?: string
          user_id?: string
          volume_mwh?: number
        }
        Relationships: [
          {
            foreignKeyName: "trades_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_trading_contract_id_fkey"
            columns: ["trading_contract_id"]
            isOneToOne: false
            referencedRelation: "trading_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_contracts: {
        Row: {
          contract_number: string
          contract_type: string
          counterparty_id: string
          created_at: string
          currency: string
          end_date: string | null
          id: string
          notes: string | null
          signed_date: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_number: string
          contract_type?: string
          counterparty_id: string
          created_at?: string
          currency?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          signed_date?: string | null
          start_date: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_number?: string
          contract_type?: string
          counterparty_id?: string
          created_at?: string
          currency?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          signed_date?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_contracts_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "management"
        | "trader"
        | "supply_manager"
        | "billing_officer"
        | "finance"
        | "risk_officer"
        | "operations"
        | "auditor"
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
    Enums: {
      app_role: [
        "admin",
        "management",
        "trader",
        "supply_manager",
        "billing_officer",
        "finance",
        "risk_officer",
        "operations",
        "auditor",
      ],
    },
  },
} as const
