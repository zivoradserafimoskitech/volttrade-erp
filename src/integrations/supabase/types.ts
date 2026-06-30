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
      asset_dispatch_schedules: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          mode: string
          notes: string | null
          schedule_id: string | null
          setpoint_kw: number
          status: string
          ts_from: string
          ts_to: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          mode?: string
          notes?: string | null
          schedule_id?: string | null
          setpoint_kw: number
          status?: string
          ts_from: string
          ts_to: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          mode?: string
          notes?: string | null
          schedule_id?: string | null
          setpoint_kw?: number
          status?: string
          ts_from?: string
          ts_to?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_dispatch_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_dispatch_schedules_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_telemetry: {
        Row: {
          alarm_code: string | null
          asset_id: string
          created_at: string
          energy_kwh: number | null
          grid_kw: number | null
          id: number
          load_kw: number | null
          power_kw: number | null
          pv_generation_kwh: number | null
          pv_irradiance_w_m2: number | null
          soc_pct: number | null
          source: string | null
          status: string | null
          ts: string
          user_id: string
        }
        Insert: {
          alarm_code?: string | null
          asset_id: string
          created_at?: string
          energy_kwh?: number | null
          grid_kw?: number | null
          id?: number
          load_kw?: number | null
          power_kw?: number | null
          pv_generation_kwh?: number | null
          pv_irradiance_w_m2?: number | null
          soc_pct?: number | null
          source?: string | null
          status?: string | null
          ts: string
          user_id: string
        }
        Update: {
          alarm_code?: string | null
          asset_id?: string
          created_at?: string
          energy_kwh?: number | null
          grid_kw?: number | null
          id?: number
          load_kw?: number | null
          power_kw?: number | null
          pv_generation_kwh?: number | null
          pv_irradiance_w_m2?: number | null
          soc_pct?: number | null
          source?: string | null
          status?: string | null
          ts?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_telemetry_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_telemetry_latest: {
        Row: {
          alarm_code: string | null
          asset_id: string
          grid_kw: number | null
          load_kw: number | null
          power_kw: number | null
          pv_generation_kwh: number | null
          soc_pct: number | null
          status: string | null
          ts: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alarm_code?: string | null
          asset_id: string
          grid_kw?: number | null
          load_kw?: number | null
          power_kw?: number | null
          pv_generation_kwh?: number | null
          soc_pct?: number | null
          status?: string | null
          ts: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alarm_code?: string | null
          asset_id?: string
          grid_kw?: number | null
          load_kw?: number | null
          power_kw?: number | null
          pv_generation_kwh?: number | null
          soc_pct?: number | null
          status?: string | null
          ts?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_telemetry_latest_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_code: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          external_ref: string | null
          id: string
          install_date: string | null
          model: string | null
          nameplate_energy_kwh: number | null
          nameplate_power_kw: number | null
          pv_dc_kwp: number | null
          site_id: string
          status: string
          updated_at: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          asset_code: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          external_ref?: string | null
          id?: string
          install_date?: string | null
          model?: string | null
          nameplate_energy_kwh?: number | null
          nameplate_power_kw?: number | null
          pv_dc_kwp?: number | null
          site_id: string
          status?: string
          updated_at?: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          asset_code?: string
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          external_ref?: string | null
          id?: string
          install_date?: string | null
          model?: string | null
          nameplate_energy_kwh?: number | null
          nameplate_power_kw?: number | null
          pv_dc_kwp?: number | null
          site_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
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
      balance_groups: {
        Row: {
          brp_party: string | null
          code: string
          country: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          brp_party?: string | null
          code: string
          country?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          brp_party?: string | null
          code?: string
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      balance_schedules: {
        Row: {
          balance_group_id: string
          created_at: string
          date: string
          gate_closure_ts: string | null
          id: string
          leg: Database["public"]["Enums"]["schedule_leg"]
          mtu: number
          scheduled_mwh: number
          updated_at: string
          version: number
        }
        Insert: {
          balance_group_id: string
          created_at?: string
          date: string
          gate_closure_ts?: string | null
          id?: string
          leg: Database["public"]["Enums"]["schedule_leg"]
          mtu: number
          scheduled_mwh?: number
          updated_at?: string
          version?: number
        }
        Update: {
          balance_group_id?: string
          created_at?: string
          date?: string
          gate_closure_ts?: string | null
          id?: string
          leg?: Database["public"]["Enums"]["schedule_leg"]
          mtu?: number
          scheduled_mwh?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "balance_schedules_balance_group_id_fkey"
            columns: ["balance_group_id"]
            isOneToOne: false
            referencedRelation: "balance_groups"
            referencedColumns: ["id"]
          },
        ]
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
          portal_user_id: string | null
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
          portal_user_id?: string | null
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
          portal_user_id?: string | null
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
      connection_points: {
        Row: {
          balance_group_id: string | null
          connection_power_kw: number | null
          consumer_type: Database["public"]["Enums"]["consumer_type"]
          created_at: string
          customer_id: string | null
          dso_meter_id: string | null
          eic_metering_id: string | null
          has_private_meter: boolean
          id: string
          is_prosumer: boolean
          metering_category: Database["public"]["Enums"]["metering_category"]
          metering_point_id: string | null
          prosumer_scheme: Database["public"]["Enums"]["prosumer_scheme"] | null
          pv_capacity_kwp: number | null
          slp_category: Database["public"]["Enums"]["slp_category"] | null
          status: string
          tariff_type: string | null
          updated_at: string
          voltage_level: string | null
        }
        Insert: {
          balance_group_id?: string | null
          connection_power_kw?: number | null
          consumer_type?: Database["public"]["Enums"]["consumer_type"]
          created_at?: string
          customer_id?: string | null
          dso_meter_id?: string | null
          eic_metering_id?: string | null
          has_private_meter?: boolean
          id?: string
          is_prosumer?: boolean
          metering_category: Database["public"]["Enums"]["metering_category"]
          metering_point_id?: string | null
          prosumer_scheme?:
            | Database["public"]["Enums"]["prosumer_scheme"]
            | null
          pv_capacity_kwp?: number | null
          slp_category?: Database["public"]["Enums"]["slp_category"] | null
          status?: string
          tariff_type?: string | null
          updated_at?: string
          voltage_level?: string | null
        }
        Update: {
          balance_group_id?: string | null
          connection_power_kw?: number | null
          consumer_type?: Database["public"]["Enums"]["consumer_type"]
          created_at?: string
          customer_id?: string | null
          dso_meter_id?: string | null
          eic_metering_id?: string | null
          has_private_meter?: boolean
          id?: string
          is_prosumer?: boolean
          metering_category?: Database["public"]["Enums"]["metering_category"]
          metering_point_id?: string | null
          prosumer_scheme?:
            | Database["public"]["Enums"]["prosumer_scheme"]
            | null
          pv_capacity_kwp?: number | null
          slp_category?: Database["public"]["Enums"]["slp_category"] | null
          status?: string
          tariff_type?: string | null
          updated_at?: string
          voltage_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connection_points_balance_group_id_fkey"
            columns: ["balance_group_id"]
            isOneToOne: false
            referencedRelation: "balance_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_points_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_points_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      consumption_readings: {
        Row: {
          actual_mwh: number | null
          created_at: string
          forecast_mwh: number | null
          id: string
          is_estimated: boolean
          metering_point_id: string
          reading_at: string
          settlement_relevant: boolean
          source: Database["public"]["Enums"]["reading_source"]
        }
        Insert: {
          actual_mwh?: number | null
          created_at?: string
          forecast_mwh?: number | null
          id?: string
          is_estimated?: boolean
          metering_point_id: string
          reading_at: string
          settlement_relevant?: boolean
          source?: Database["public"]["Enums"]["reading_source"]
        }
        Update: {
          actual_mwh?: number | null
          created_at?: string
          forecast_mwh?: number | null
          id?: string
          is_estimated?: boolean
          metering_point_id?: string
          reading_at?: string
          settlement_relevant?: boolean
          source?: Database["public"]["Enums"]["reading_source"]
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
      ev_charge_plans: {
        Row: {
          avg_price_eur_mwh: number | null
          client_id: string
          created_at: string
          est_cost_eur: number
          est_kwh: number
          id: string
          plan_for_date: string
          schedule: Json
          vehicle_id: string
        }
        Insert: {
          avg_price_eur_mwh?: number | null
          client_id: string
          created_at?: string
          est_cost_eur?: number
          est_kwh?: number
          id?: string
          plan_for_date: string
          schedule: Json
          vehicle_id: string
        }
        Update: {
          avg_price_eur_mwh?: number | null
          client_id?: string
          created_at?: string
          est_cost_eur?: number
          est_kwh?: number
          id?: string
          plan_for_date?: string
          schedule?: Json
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ev_charge_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ev_charge_plans_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "ev_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      ev_vehicles: {
        Row: {
          battery_kwh: number
          client_id: string
          created_at: string
          current_soc_pct: number
          id: string
          make: string | null
          max_charge_kw: number
          model: string | null
          nickname: string
          plugged_in: boolean
          ready_by_time: string
          target_soc_pct: number
          updated_at: string
        }
        Insert: {
          battery_kwh?: number
          client_id: string
          created_at?: string
          current_soc_pct?: number
          id?: string
          make?: string | null
          max_charge_kw?: number
          model?: string | null
          nickname: string
          plugged_in?: boolean
          ready_by_time?: string
          target_soc_pct?: number
          updated_at?: string
        }
        Update: {
          battery_kwh?: number
          client_id?: string
          created_at?: string
          current_soc_pct?: number
          id?: string
          make?: string | null
          max_charge_kw?: number
          model?: string | null
          nickname?: string
          plugged_in?: boolean
          ready_by_time?: string
          target_soc_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ev_vehicles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
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
      kyc_documents: {
        Row: {
          created_at: string
          doc_type: string
          file_name: string | null
          file_path: string
          id: string
          lead_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          file_name?: string | null
          file_path: string
          id?: string
          lead_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          file_name?: string | null
          file_path?: string
          id?: string
          lead_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_quotes: {
        Row: {
          annual_cost_eur: number | null
          annual_volume_mwh: number | null
          base_price_eur_mwh: number | null
          created_at: string
          id: string
          lead_id: string
          margin_eur_mwh: number | null
          pdf_url: string | null
          status: string
          tariff_id: string | null
          term_months: number | null
          updated_at: string
        }
        Insert: {
          annual_cost_eur?: number | null
          annual_volume_mwh?: number | null
          base_price_eur_mwh?: number | null
          created_at?: string
          id?: string
          lead_id: string
          margin_eur_mwh?: number | null
          pdf_url?: string | null
          status?: string
          tariff_id?: string | null
          term_months?: number | null
          updated_at?: string
        }
        Update: {
          annual_cost_eur?: number | null
          annual_volume_mwh?: number | null
          base_price_eur_mwh?: number | null
          created_at?: string
          id?: string
          lead_id?: string
          margin_eur_mwh?: number | null
          pdf_url?: string | null
          status?: string
          tariff_id?: string | null
          term_months?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_quotes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_quotes_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          converted_client_id: string | null
          country: string | null
          created_at: string
          est_annual_mwh: number | null
          est_value_eur: number | null
          id: string
          lost_reason: string | null
          notes: string | null
          owner: string | null
          source: string | null
          stage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_client_id?: string | null
          country?: string | null
          created_at?: string
          est_annual_mwh?: number | null
          est_value_eur?: number | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          owner?: string | null
          source?: string | null
          stage?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_client_id?: string | null
          country?: string | null
          created_at?: string
          est_annual_mwh?: number | null
          est_value_eur?: number | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          owner?: string | null
          source?: string | null
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
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
          has_pv: boolean
          id: string
          meter_id: string | null
          notes: string | null
          pv_capacity_kw: number | null
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
          has_pv?: boolean
          id?: string
          meter_id?: string | null
          notes?: string | null
          pv_capacity_kw?: number | null
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
          has_pv?: boolean
          id?: string
          meter_id?: string | null
          notes?: string | null
          pv_capacity_kw?: number | null
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
      ppa_agreements: {
        Row: {
          asset_id: string | null
          buyback_price_eur_mwh: number | null
          ceiling_price_eur_mwh: number | null
          client_id: string
          contracted_volume_mwh: number | null
          created_at: string
          currency: string
          end_date: string
          fixed_price_eur_mwh: number
          floor_price_eur_mwh: number | null
          id: string
          metering_point_id: string | null
          notes: string | null
          ppa_code: string
          ppa_type: string
          start_date: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          asset_id?: string | null
          buyback_price_eur_mwh?: number | null
          ceiling_price_eur_mwh?: number | null
          client_id: string
          contracted_volume_mwh?: number | null
          created_at?: string
          currency?: string
          end_date: string
          fixed_price_eur_mwh: number
          floor_price_eur_mwh?: number | null
          id?: string
          metering_point_id?: string | null
          notes?: string | null
          ppa_code: string
          ppa_type: string
          start_date: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          asset_id?: string | null
          buyback_price_eur_mwh?: number | null
          ceiling_price_eur_mwh?: number | null
          client_id?: string
          contracted_volume_mwh?: number | null
          created_at?: string
          currency?: string
          end_date?: string
          fixed_price_eur_mwh?: number
          floor_price_eur_mwh?: number | null
          id?: string
          metering_point_id?: string | null
          notes?: string | null
          ppa_code?: string
          ppa_type?: string
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ppa_agreements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppa_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppa_agreements_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      ppa_settlements: {
        Row: {
          applied_price_eur_mwh: number
          buyback_credit_eur: number
          created_at: string
          delivered_mwh: number
          energy_cost_eur: number
          id: string
          invoice_id: string | null
          net_amount_eur: number
          period_month: string
          ppa_id: string
          produced_mwh: number
          spot_avg_eur_mwh: number | null
          status: string
          surplus_export_mwh: number
          updated_at: string
        }
        Insert: {
          applied_price_eur_mwh: number
          buyback_credit_eur?: number
          created_at?: string
          delivered_mwh?: number
          energy_cost_eur?: number
          id?: string
          invoice_id?: string | null
          net_amount_eur?: number
          period_month: string
          ppa_id: string
          produced_mwh?: number
          spot_avg_eur_mwh?: number | null
          status?: string
          surplus_export_mwh?: number
          updated_at?: string
        }
        Update: {
          applied_price_eur_mwh?: number
          buyback_credit_eur?: number
          created_at?: string
          delivered_mwh?: number
          energy_cost_eur?: number
          id?: string
          invoice_id?: string | null
          net_amount_eur?: number
          period_month?: string
          ppa_id?: string
          produced_mwh?: number
          spot_avg_eur_mwh?: number | null
          status?: string
          surplus_export_mwh?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ppa_settlements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppa_settlements_ppa_id_fkey"
            columns: ["ppa_id"]
            isOneToOne: false
            referencedRelation: "ppa_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          credit_eur: number
          credited_at: string | null
          id: string
          referred_email: string | null
          referred_name: string | null
          referrer_client_id: string
          signed_up_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          credit_eur?: number
          credited_at?: string | null
          id?: string
          referred_email?: string | null
          referred_name?: string | null
          referrer_client_id: string
          signed_up_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          credit_eur?: number
          credited_at?: string | null
          id?: string
          referred_email?: string | null
          referred_name?: string | null
          referrer_client_id?: string
          signed_up_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referrer_client_id_fkey"
            columns: ["referrer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards_ledger: {
        Row: {
          amount_eur: number
          client_id: string
          created_at: string
          entry_type: string
          id: string
          note: string | null
          points: number
          reference_id: string | null
        }
        Insert: {
          amount_eur?: number
          client_id: string
          created_at?: string
          entry_type: string
          id?: string
          note?: string | null
          points?: number
          reference_id?: string | null
        }
        Update: {
          amount_eur?: number
          client_id?: string
          created_at?: string
          entry_type?: string
          id?: string
          note?: string | null
          points?: number
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rewards_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      saving_session_signups: {
        Row: {
          actual_kwh: number | null
          baseline_kwh: number | null
          client_id: string
          created_at: string
          credit_eur: number | null
          id: string
          opted_in_at: string
          points_awarded: number | null
          saved_kwh: number | null
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          actual_kwh?: number | null
          baseline_kwh?: number | null
          client_id: string
          created_at?: string
          credit_eur?: number | null
          id?: string
          opted_in_at?: string
          points_awarded?: number | null
          saved_kwh?: number | null
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          actual_kwh?: number | null
          baseline_kwh?: number | null
          client_id?: string
          created_at?: string
          credit_eur?: number | null
          id?: string
          opted_in_at?: string
          points_awarded?: number | null
          saved_kwh?: number | null
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saving_session_signups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saving_session_signups_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "saving_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      saving_sessions: {
        Row: {
          baseline_method: string
          created_at: string
          description: string | null
          eur_per_point: number
          id: string
          points_per_kwh: number
          status: string
          title: string
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          baseline_method?: string
          created_at?: string
          description?: string | null
          eur_per_point?: number
          id?: string
          points_per_kwh?: number
          status?: string
          title: string
          updated_at?: string
          window_end: string
          window_start: string
        }
        Update: {
          baseline_method?: string
          created_at?: string
          description?: string | null
          eur_per_point?: number
          id?: string
          points_per_kwh?: number
          status?: string
          title?: string
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
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
      settlements: {
        Row: {
          actual_mwh: number
          balance_group_id: string | null
          created_at: string
          grid_loss_factor: number | null
          id: string
          imbalance_cost: number
          imbalance_mwh: number
          imbalance_price: number
          imbalance_price_down: number | null
          imbalance_price_up: number | null
          notes: string | null
          period_end: string
          period_start: string
          scheduled_mwh: number
          segment: Database["public"]["Enums"]["schedule_leg"]
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        Insert: {
          actual_mwh?: number
          balance_group_id?: string | null
          created_at?: string
          grid_loss_factor?: number | null
          id?: string
          imbalance_cost?: number
          imbalance_mwh?: number
          imbalance_price?: number
          imbalance_price_down?: number | null
          imbalance_price_up?: number | null
          notes?: string | null
          period_end: string
          period_start: string
          scheduled_mwh?: number
          segment: Database["public"]["Enums"]["schedule_leg"]
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Update: {
          actual_mwh?: number
          balance_group_id?: string | null
          created_at?: string
          grid_loss_factor?: number | null
          id?: string
          imbalance_cost?: number
          imbalance_mwh?: number
          imbalance_price?: number
          imbalance_price_down?: number | null
          imbalance_price_up?: number | null
          notes?: string | null
          period_end?: string
          period_start?: string
          scheduled_mwh?: number
          segment?: Database["public"]["Enums"]["schedule_leg"]
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_balance_group_id_fkey"
            columns: ["balance_group_id"]
            isOneToOne: false
            referencedRelation: "balance_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          country: string | null
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          metering_point_id: string | null
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          country?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          metering_point_id?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          country?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          metering_point_id?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      slp_coefficients: {
        Row: {
          coefficient: number
          day_type: Database["public"]["Enums"]["day_type_t"]
          hour: number
          id: number
          season: Database["public"]["Enums"]["season_t"]
          slp_category: Database["public"]["Enums"]["slp_category"]
        }
        Insert: {
          coefficient: number
          day_type: Database["public"]["Enums"]["day_type_t"]
          hour: number
          id?: number
          season: Database["public"]["Enums"]["season_t"]
          slp_category: Database["public"]["Enums"]["slp_category"]
        }
        Update: {
          coefficient?: number
          day_type?: Database["public"]["Enums"]["day_type_t"]
          hour?: number
          id?: number
          season?: Database["public"]["Enums"]["season_t"]
          slp_category?: Database["public"]["Enums"]["slp_category"]
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
      switch_requests: {
        Row: {
          client_id: string | null
          confirmed_date: string | null
          created_at: string
          current_supplier: string | null
          direction: string
          dso_status: string
          edu_code: string
          id: string
          lost_reason: string | null
          message_envelope: string | null
          new_supplier: string | null
          notes: string | null
          requested_date: string | null
          updated_at: string
          user_id: string
          volume_estimate_mwh: number | null
          win_back_discount_eur_mwh: number | null
          win_back_offered: boolean | null
        }
        Insert: {
          client_id?: string | null
          confirmed_date?: string | null
          created_at?: string
          current_supplier?: string | null
          direction: string
          dso_status?: string
          edu_code: string
          id?: string
          lost_reason?: string | null
          message_envelope?: string | null
          new_supplier?: string | null
          notes?: string | null
          requested_date?: string | null
          updated_at?: string
          user_id: string
          volume_estimate_mwh?: number | null
          win_back_discount_eur_mwh?: number | null
          win_back_offered?: boolean | null
        }
        Update: {
          client_id?: string | null
          confirmed_date?: string | null
          created_at?: string
          current_supplier?: string | null
          direction?: string
          dso_status?: string
          edu_code?: string
          id?: string
          lost_reason?: string | null
          message_envelope?: string | null
          new_supplier?: string | null
          notes?: string | null
          requested_date?: string | null
          updated_at?: string
          user_id?: string
          volume_estimate_mwh?: number | null
          win_back_discount_eur_mwh?: number | null
          win_back_offered?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "switch_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_switch_requests: {
        Row: {
          client_id: string
          created_at: string
          id: string
          notes: string | null
          processed_at: string | null
          requested_at: string
          status: string
          target_tariff_code: string
          target_tariff_name: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          processed_at?: string | null
          requested_at?: string
          status?: string
          target_tariff_code: string
          target_tariff_name?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          processed_at?: string | null
          requested_at?: string
          status?: string
          target_tariff_code?: string
          target_tariff_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariff_switch_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      current_portal_client_id: { Args: never; Returns: string }
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
        | "customer"
      asset_type: "bess" | "pv" | "hybrid"
      consumer_type: "Residential" | "SOHO" | "SME" | "Industrial" | "Public"
      day_type_t: "WD" | "SA" | "SU"
      metering_category: "PROFILED" | "MEASURED"
      prosumer_scheme: "NET_METERING" | "NET_BILLING"
      reading_source:
        | "DSO_MONTHLY"
        | "DSO_INTERVAL"
        | "PRIVATE_SMART"
        | "SIMULATED"
      schedule_leg: "PROFILED" | "MEASURED" | "PV"
      season_t: "Spring" | "Summer" | "Autumn" | "Winter"
      settlement_status: "PROVISIONAL" | "FINAL"
      slp_category:
        | "Office"
        | "Cafe_Restaurant"
        | "Market_Shop"
        | "Bakery"
        | "Street_Lighting"
        | "Base_Station"
        | "Fuel_Station"
        | "Household"
        | "Household_Electric_Heating"
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
        "customer",
      ],
      asset_type: ["bess", "pv", "hybrid"],
      consumer_type: ["Residential", "SOHO", "SME", "Industrial", "Public"],
      day_type_t: ["WD", "SA", "SU"],
      metering_category: ["PROFILED", "MEASURED"],
      prosumer_scheme: ["NET_METERING", "NET_BILLING"],
      reading_source: [
        "DSO_MONTHLY",
        "DSO_INTERVAL",
        "PRIVATE_SMART",
        "SIMULATED",
      ],
      schedule_leg: ["PROFILED", "MEASURED", "PV"],
      season_t: ["Spring", "Summer", "Autumn", "Winter"],
      settlement_status: ["PROVISIONAL", "FINAL"],
      slp_category: [
        "Office",
        "Cafe_Restaurant",
        "Market_Shop",
        "Bakery",
        "Street_Lighting",
        "Base_Station",
        "Fuel_Station",
        "Household",
        "Household_Electric_Heating",
      ],
    },
  },
} as const
