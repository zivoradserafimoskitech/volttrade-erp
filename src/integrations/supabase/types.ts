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
          created_by: string | null
          gateway_plan_id: number | null
          id: string
          last_error: string | null
          mode: string
          notes: string | null
          organization_id: string
          schedule_id: string | null
          sent_at: string | null
          setpoint_kw: number
          status: string
          ts_from: string
          ts_to: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          gateway_plan_id?: number | null
          id?: string
          last_error?: string | null
          mode?: string
          notes?: string | null
          organization_id?: string
          schedule_id?: string | null
          sent_at?: string | null
          setpoint_kw: number
          status?: string
          ts_from: string
          ts_to: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          gateway_plan_id?: number | null
          id?: string
          last_error?: string | null
          mode?: string
          notes?: string | null
          organization_id?: string
          schedule_id?: string | null
          sent_at?: string | null
          setpoint_kw?: number
          status?: string
          ts_from?: string
          ts_to?: string
          updated_at?: string
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
            foreignKeyName: "asset_dispatch_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          created_by: string | null
          energy_kwh: number | null
          grid_kw: number | null
          id: number
          load_kw: number | null
          organization_id: string
          power_kw: number | null
          pv_generation_kwh: number | null
          pv_irradiance_w_m2: number | null
          soc_pct: number | null
          source: string | null
          status: string | null
          ts: string
        }
        Insert: {
          alarm_code?: string | null
          asset_id: string
          created_at?: string
          created_by?: string | null
          energy_kwh?: number | null
          grid_kw?: number | null
          id?: number
          load_kw?: number | null
          organization_id?: string
          power_kw?: number | null
          pv_generation_kwh?: number | null
          pv_irradiance_w_m2?: number | null
          soc_pct?: number | null
          source?: string | null
          status?: string | null
          ts: string
        }
        Update: {
          alarm_code?: string | null
          asset_id?: string
          created_at?: string
          created_by?: string | null
          energy_kwh?: number | null
          grid_kw?: number | null
          id?: number
          load_kw?: number | null
          organization_id?: string
          power_kw?: number | null
          pv_generation_kwh?: number | null
          pv_irradiance_w_m2?: number | null
          soc_pct?: number | null
          source?: string | null
          status?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_telemetry_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_telemetry_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_telemetry_latest: {
        Row: {
          alarm_code: string | null
          asset_id: string
          created_by: string | null
          grid_kw: number | null
          load_kw: number | null
          organization_id: string
          power_kw: number | null
          pv_generation_kwh: number | null
          soc_pct: number | null
          status: string | null
          ts: string
          updated_at: string
        }
        Insert: {
          alarm_code?: string | null
          asset_id: string
          created_by?: string | null
          grid_kw?: number | null
          load_kw?: number | null
          organization_id?: string
          power_kw?: number | null
          pv_generation_kwh?: number | null
          soc_pct?: number | null
          status?: string | null
          ts: string
          updated_at?: string
        }
        Update: {
          alarm_code?: string | null
          asset_id?: string
          created_by?: string | null
          grid_kw?: number | null
          load_kw?: number | null
          organization_id?: string
          power_kw?: number | null
          pv_generation_kwh?: number | null
          soc_pct?: number | null
          status?: string | null
          ts?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_telemetry_latest_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_telemetry_latest_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_code: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          charge_efficiency: number
          created_at: string
          created_by: string | null
          degradation_eur_per_mwh: number | null
          discharge_efficiency: number
          external_ref: string | null
          gateway_device_id: number | null
          grid_export_limit_kw: number | null
          grid_import_limit_kw: number | null
          id: string
          install_date: string | null
          max_cycles_per_day: number
          model: string | null
          nameplate_energy_kwh: number | null
          nameplate_power_kw: number | null
          organization_id: string
          pv_dc_kwp: number | null
          site_id: string
          soc_max_pct: number
          soc_min_pct: number
          soc_terminal_pct: number
          status: string
          updated_at: string
          usable_energy_kwh: number | null
          vendor: string | null
        }
        Insert: {
          asset_code: string
          asset_type: Database["public"]["Enums"]["asset_type"]
          charge_efficiency?: number
          created_at?: string
          created_by?: string | null
          degradation_eur_per_mwh?: number | null
          discharge_efficiency?: number
          external_ref?: string | null
          gateway_device_id?: number | null
          grid_export_limit_kw?: number | null
          grid_import_limit_kw?: number | null
          id?: string
          install_date?: string | null
          max_cycles_per_day?: number
          model?: string | null
          nameplate_energy_kwh?: number | null
          nameplate_power_kw?: number | null
          organization_id?: string
          pv_dc_kwp?: number | null
          site_id: string
          soc_max_pct?: number
          soc_min_pct?: number
          soc_terminal_pct?: number
          status?: string
          updated_at?: string
          usable_energy_kwh?: number | null
          vendor?: string | null
        }
        Update: {
          asset_code?: string
          asset_type?: Database["public"]["Enums"]["asset_type"]
          charge_efficiency?: number
          created_at?: string
          created_by?: string | null
          degradation_eur_per_mwh?: number | null
          discharge_efficiency?: number
          external_ref?: string | null
          gateway_device_id?: number | null
          grid_export_limit_kw?: number | null
          grid_import_limit_kw?: number | null
          id?: string
          install_date?: string | null
          max_cycles_per_day?: number
          model?: string | null
          nameplate_energy_kwh?: number | null
          nameplate_power_kw?: number | null
          organization_id?: string
          pv_dc_kwp?: number | null
          site_id?: string
          soc_max_pct?: number
          soc_min_pct?: number
          soc_terminal_pct?: number
          status?: string
          updated_at?: string
          usable_energy_kwh?: number | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_results: {
        Row: {
          avg_daily_profit_eur: number
          capture_ratio_pct: number | null
          created_at: string
          id: string
          max_drawdown_eur: number
          model_id: string | null
          organization_id: string
          period_from: string
          period_to: string
          scenarios_json: Json
          sharpe_ratio: number | null
          strategy_name: string
          total_days: number
          total_profit_eur: number
          win_rate_pct: number | null
        }
        Insert: {
          avg_daily_profit_eur: number
          capture_ratio_pct?: number | null
          created_at?: string
          id?: string
          max_drawdown_eur: number
          model_id?: string | null
          organization_id: string
          period_from: string
          period_to: string
          scenarios_json?: Json
          sharpe_ratio?: number | null
          strategy_name: string
          total_days: number
          total_profit_eur: number
          win_rate_pct?: number | null
        }
        Update: {
          avg_daily_profit_eur?: number
          capture_ratio_pct?: number | null
          created_at?: string
          id?: string
          max_drawdown_eur?: number
          model_id?: string | null
          organization_id?: string
          period_from?: string
          period_to?: string
          scenarios_json?: Json
          sharpe_ratio?: number | null
          strategy_name?: string
          total_days?: number
          total_profit_eur?: number
          win_rate_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "backtest_results_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "forecast_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backtest_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      bess_dispatch_schedules: {
        Row: {
          asset_id: string | null
          charge_mw: number
          created_at: string
          delivery_date: string
          discharge_mw: number
          hour_of_day: number
          id: string
          organization_id: string
          price_actual_eur_mwh: number | null
          price_forecast_eur_mwh: number | null
          revenue_eur: number | null
          soc_pct: number
        }
        Insert: {
          asset_id?: string | null
          charge_mw?: number
          created_at?: string
          delivery_date: string
          discharge_mw?: number
          hour_of_day: number
          id?: string
          organization_id: string
          price_actual_eur_mwh?: number | null
          price_forecast_eur_mwh?: number | null
          revenue_eur?: number | null
          soc_pct: number
        }
        Update: {
          asset_id?: string | null
          charge_mw?: number
          created_at?: string
          delivery_date?: string
          discharge_mw?: number
          hour_of_day?: number
          id?: string
          organization_id?: string
          price_actual_eur_mwh?: number | null
          price_forecast_eur_mwh?: number | null
          revenue_eur?: number | null
          soc_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "bess_dispatch_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bess_dispatch_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bess_optimizer_runs: {
        Row: {
          asset_id: string
          backtest: boolean
          binding_constraint: string | null
          created_at: string
          created_by: string | null
          cycles_used: number | null
          degradation_cost_eur: number | null
          expected_revenue_eur: number | null
          horizon_end: string
          horizon_start: string
          id: string
          mode: string
          net_value_eur: number | null
          periods: number
          plan: Json | null
          prices: Json | null
          start_soc_at: string | null
          start_soc_kwh: number | null
        }
        Insert: {
          asset_id: string
          backtest?: boolean
          binding_constraint?: string | null
          created_at?: string
          created_by?: string | null
          cycles_used?: number | null
          degradation_cost_eur?: number | null
          expected_revenue_eur?: number | null
          horizon_end: string
          horizon_start: string
          id?: string
          mode?: string
          net_value_eur?: number | null
          periods: number
          plan?: Json | null
          prices?: Json | null
          start_soc_at?: string | null
          start_soc_kwh?: number | null
        }
        Update: {
          asset_id?: string
          backtest?: boolean
          binding_constraint?: string | null
          created_at?: string
          created_by?: string | null
          cycles_used?: number | null
          degradation_cost_eur?: number | null
          expected_revenue_eur?: number | null
          horizon_end?: string
          horizon_start?: string
          id?: string
          mode?: string
          net_value_eur?: number | null
          periods?: number
          plan?: Json | null
          prices?: Json | null
          start_soc_at?: string | null
          start_soc_kwh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bess_optimizer_runs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_run_inputs: {
        Row: {
          billing_run_id: string
          created_at: string
          engine_version: string
          id: string
          input_hash: string
          input_snapshot: Json
          output_snapshot: Json
          warnings: Json
        }
        Insert: {
          billing_run_id: string
          created_at?: string
          engine_version: string
          id?: string
          input_hash: string
          input_snapshot: Json
          output_snapshot: Json
          warnings?: Json
        }
        Update: {
          billing_run_id?: string
          created_at?: string
          engine_version?: string
          id?: string
          input_hash?: string
          input_snapshot?: Json
          output_snapshot?: Json
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "billing_run_inputs_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_runs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          invoice_count: number
          notes: string | null
          organization_id: string
          period_end: string
          period_start: string
          scope: string
          scope_id: string | null
          status: string
          total_eur: number
          total_mwh: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_count?: number
          notes?: string | null
          organization_id?: string
          period_end: string
          period_start: string
          scope?: string
          scope_id?: string | null
          status?: string
          total_eur?: number
          total_mwh?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_count?: number
          notes?: string | null
          organization_id?: string
          period_end?: string
          period_start?: string
          scope?: string
          scope_id?: string | null
          status?: string
          total_eur?: number
          total_mwh?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          created_by: string | null
          credit_limit_eur: number
          customer_category: string
          fixed_price_eur_mwh: number | null
          id: string
          margin_eur_mwh: number
          notes: string | null
          organization_id: string
          payment_terms_days: number
          portal_user_id: string | null
          price_override: boolean
          status: string
          tariff_id: string | null
          tax_id: string | null
          updated_at: string
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
          created_by?: string | null
          credit_limit_eur?: number
          customer_category?: string
          fixed_price_eur_mwh?: number | null
          id?: string
          margin_eur_mwh?: number
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          portal_user_id?: string | null
          price_override?: boolean
          status?: string
          tariff_id?: string | null
          tax_id?: string | null
          updated_at?: string
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
          created_by?: string | null
          credit_limit_eur?: number
          customer_category?: string
          fixed_price_eur_mwh?: number | null
          id?: string
          margin_eur_mwh?: number
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          portal_user_id?: string | null
          price_override?: boolean
          status?: string
          tariff_id?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_obligations: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          due_rule: Json
          id: string
          legal_ref: string | null
          recurrence: string
          responsible_role: Database["public"]["Enums"]["app_role"] | null
          title: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          due_rule: Json
          id?: string
          legal_ref?: string | null
          recurrence: string
          responsible_role?: Database["public"]["Enums"]["app_role"] | null
          title: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          due_rule?: Json
          id?: string
          legal_ref?: string | null
          recurrence?: string
          responsible_role?: Database["public"]["Enums"]["app_role"] | null
          title?: string
        }
        Relationships: []
      }
      compliance_tasks: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          due_at: string
          id: string
          notes: string | null
          obligation_id: string
          period_label: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at: string
          id?: string
          notes?: string | null
          obligation_id: string
          period_label: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at?: string
          id?: string
          notes?: string | null
          obligation_id?: string
          period_label?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_tasks_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
        ]
      }
      consumer_applications: {
        Row: {
          client_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          pod_code: string
          status: string
          updated_at: string
          user_email: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          pod_code: string
          status?: string
          updated_at?: string
          user_email: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          pod_code?: string
          status?: string
          updated_at?: string
          user_email?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumer_applications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
          quality: string
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
          quality?: string
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
          quality?: string
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
          created_by: string | null
          credit_limit_eur: number
          eic_code: string | null
          id: string
          legal_name: string
          notes: string | null
          organization_id: string
          payment_terms_days: number
          risk_status: string
          short_name: string | null
          status: string
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit_eur?: number
          eic_code?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          risk_status?: string
          short_name?: string | null
          status?: string
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit_eur?: number
          eic_code?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          risk_status?: string
          short_name?: string | null
          status?: string
          updated_at?: string
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
          {
            foreignKeyName: "counterparties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
      device_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen: string
          platform: string
          token: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen?: string
          platform?: string
          token: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen?: string
          platform?: string
          token?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      eic_areas: {
        Row: {
          country_code: string | null
          eic: string
          is_default: boolean
          name: string
        }
        Insert: {
          country_code?: string | null
          eic: string
          is_default?: boolean
          name: string
        }
        Update: {
          country_code?: string | null
          eic?: string
          is_default?: boolean
          name?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      ess_settings: {
        Row: {
          default_area_eic: string
          id: boolean
          opee_eic: string | null
          ppee_series_id: string
          receiver_eic: string
          receiver_role: string
          sender_eic: string
          sender_role: string
          updated_at: string
        }
        Insert: {
          default_area_eic?: string
          id?: boolean
          opee_eic?: string | null
          ppee_series_id?: string
          receiver_eic?: string
          receiver_role?: string
          sender_eic: string
          sender_role?: string
          updated_at?: string
        }
        Update: {
          default_area_eic?: string
          id?: boolean
          opee_eic?: string | null
          ppee_series_id?: string
          receiver_eic?: string
          receiver_role?: string
          sender_eic?: string
          sender_role?: string
          updated_at?: string
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
      external_api_log: {
        Row: {
          called_at: string
          detail: Json | null
          endpoint: string | null
          id: string
          provider: string
          status: number | null
        }
        Insert: {
          called_at?: string
          detail?: Json | null
          endpoint?: string | null
          id?: string
          provider: string
          status?: number | null
        }
        Update: {
          called_at?: string
          detail?: Json | null
          endpoint?: string | null
          id?: string
          provider?: string
          status?: number | null
        }
        Relationships: []
      }
      forecast_models: {
        Row: {
          capture_ratio_pct: number | null
          coverage_pct: number | null
          created_at: string
          features_json: Json
          horizon_hours: number
          hyperparams_json: Json
          id: string
          is_active: boolean
          last_trained_at: string | null
          mae: number | null
          model_name: string
          model_path: string | null
          model_type: string
          organization_id: string
          rmse: number | null
        }
        Insert: {
          capture_ratio_pct?: number | null
          coverage_pct?: number | null
          created_at?: string
          features_json?: Json
          horizon_hours?: number
          hyperparams_json?: Json
          id?: string
          is_active?: boolean
          last_trained_at?: string | null
          mae?: number | null
          model_name: string
          model_path?: string | null
          model_type: string
          organization_id: string
          rmse?: number | null
        }
        Update: {
          capture_ratio_pct?: number | null
          coverage_pct?: number | null
          created_at?: string
          features_json?: Json
          horizon_hours?: number
          hyperparams_json?: Json
          id?: string
          is_active?: boolean
          last_trained_at?: string | null
          mae?: number | null
          model_name?: string
          model_path?: string | null
          model_type?: string
          organization_id?: string
          rmse?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_models_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_predictions: {
        Row: {
          actual: number | null
          created_at: string
          horizon_hours: number
          id: string
          model_kind: string
          model_version: string | null
          organization_id: string
          p10: number | null
          p50: number | null
          p90: number | null
          scored_at: string | null
          target_time: string
          zone: string
        }
        Insert: {
          actual?: number | null
          created_at?: string
          horizon_hours: number
          id?: string
          model_kind: string
          model_version?: string | null
          organization_id: string
          p10?: number | null
          p50?: number | null
          p90?: number | null
          scored_at?: string | null
          target_time: string
          zone: string
        }
        Update: {
          actual?: number | null
          created_at?: string
          horizon_hours?: number
          id?: string
          model_kind?: string
          model_version?: string | null
          organization_id?: string
          p10?: number | null
          p50?: number | null
          p90?: number | null
          scored_at?: string | null
          target_time?: string
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_predictions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          created_by: string | null
          external_source: string | null
          external_synced_at: string | null
          forecast_date: string
          forecast_mwh: number
          forecast_mwh_external: number | null
          id: string
          method: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          budget_eur?: number | null
          budget_mwh?: number | null
          client_id: string
          created_at?: string
          created_by?: string | null
          external_source?: string | null
          external_synced_at?: string | null
          forecast_date: string
          forecast_mwh?: number
          forecast_mwh_external?: number | null
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Update: {
          budget_eur?: number | null
          budget_mwh?: number | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          external_source?: string | null
          external_synced_at?: string | null
          forecast_date?: string
          forecast_mwh?: number
          forecast_mwh_external?: number | null
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecasts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_alarms: {
        Row: {
          acknowledged_at: string | null
          asset_id: string | null
          device_id: number | null
          gateway_alarm_id: number
          gateway_id: number | null
          id: string
          message: string | null
          metering_point_id: string | null
          metric: string
          resolved_at: string | null
          severity: string
          status: string
          synced_at: string
          threshold: number | null
          triggered_at: string
          value: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          asset_id?: string | null
          device_id?: number | null
          gateway_alarm_id: number
          gateway_id?: number | null
          id?: string
          message?: string | null
          metering_point_id?: string | null
          metric: string
          resolved_at?: string | null
          severity: string
          status: string
          synced_at?: string
          threshold?: number | null
          triggered_at: string
          value?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          asset_id?: string | null
          device_id?: number | null
          gateway_alarm_id?: number
          gateway_id?: number | null
          id?: string
          message?: string | null
          metering_point_id?: string | null
          metric?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          synced_at?: string
          threshold?: number | null
          triggered_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gateway_alarms_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_alarms_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_dispatches: {
        Row: {
          channel: string
          client_id: string
          created_at: string
          created_by: string | null
          dunning_level: number
          error: string | null
          id: string
          invoice_id: string
          kind: string
          language: string
          recipient: string | null
          status: string
        }
        Insert: {
          channel?: string
          client_id: string
          created_at?: string
          created_by?: string | null
          dunning_level?: number
          error?: string | null
          id?: string
          invoice_id: string
          kind: string
          language?: string
          recipient?: string | null
          status?: string
        }
        Update: {
          channel?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          dunning_level?: number
          error?: string | null
          id?: string
          invoice_id?: string
          kind?: string
          language?: string
          recipient?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_dispatches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_dispatches_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_counters: {
        Row: {
          fiscal_year: number
          last_number: number
          prefix: string
          updated_at: string
        }
        Insert: {
          fiscal_year: number
          last_number?: number
          prefix?: string
          updated_at?: string
        }
        Update: {
          fiscal_year?: number
          last_number?: number
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          billing_run_id: string | null
          client_id: string
          components: Json
          created_at: string
          created_by: string | null
          currency: string
          doc_type: string
          due_date: string | null
          dunning_level: number
          energy_amount_eur: number
          id: string
          invoice_number: string | null
          issued_at: string | null
          last_dunning_at: string | null
          last_reminder_at: string | null
          margin_amount_eur: number
          notice_language: string | null
          organization_id: string
          paid_amount_eur: number
          period_end: string
          period_start: string
          reminder_count: number
          sent_at: string | null
          sent_count: number
          status: string
          tax_amount_eur: number
          total_eur: number
          total_mwh: number
        }
        Insert: {
          billing_run_id?: string | null
          client_id: string
          components?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          doc_type?: string
          due_date?: string | null
          dunning_level?: number
          energy_amount_eur?: number
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          last_dunning_at?: string | null
          last_reminder_at?: string | null
          margin_amount_eur?: number
          notice_language?: string | null
          organization_id?: string
          paid_amount_eur?: number
          period_end: string
          period_start: string
          reminder_count?: number
          sent_at?: string | null
          sent_count?: number
          status?: string
          tax_amount_eur?: number
          total_eur?: number
          total_mwh?: number
        }
        Update: {
          billing_run_id?: string | null
          client_id?: string
          components?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          doc_type?: string
          due_date?: string | null
          dunning_level?: number
          energy_amount_eur?: number
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          last_dunning_at?: string | null
          last_reminder_at?: string | null
          margin_amount_eur?: number
          notice_language?: string | null
          organization_id?: string
          paid_amount_eur?: number
          period_end?: string
          period_start?: string
          reminder_count?: number
          sent_at?: string | null
          sent_count?: number
          status?: string
          tax_amount_eur?: number
          total_eur?: number
          total_mwh?: number
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
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          capture_factor: number | null
          captured_price_eur_mwh: number | null
          created_at: string
          id: string
          lead_id: string
          margin_eur_mwh: number | null
          pdf_url: string | null
          profile_key: string | null
          required_price_eur_mwh: number | null
          risk_capacity_ok: boolean | null
          status: string
          tariff_id: string | null
          term_months: number | null
          updated_at: string
          volume_risk_premium_eur_mwh: number | null
        }
        Insert: {
          annual_cost_eur?: number | null
          annual_volume_mwh?: number | null
          base_price_eur_mwh?: number | null
          capture_factor?: number | null
          captured_price_eur_mwh?: number | null
          created_at?: string
          id?: string
          lead_id: string
          margin_eur_mwh?: number | null
          pdf_url?: string | null
          profile_key?: string | null
          required_price_eur_mwh?: number | null
          risk_capacity_ok?: boolean | null
          status?: string
          tariff_id?: string | null
          term_months?: number | null
          updated_at?: string
          volume_risk_premium_eur_mwh?: number | null
        }
        Update: {
          annual_cost_eur?: number | null
          annual_volume_mwh?: number | null
          base_price_eur_mwh?: number | null
          capture_factor?: number | null
          captured_price_eur_mwh?: number | null
          created_at?: string
          id?: string
          lead_id?: string
          margin_eur_mwh?: number | null
          pdf_url?: string | null
          profile_key?: string | null
          required_price_eur_mwh?: number | null
          risk_capacity_ok?: boolean | null
          status?: string
          tariff_id?: string | null
          term_months?: number | null
          updated_at?: string
          volume_risk_premium_eur_mwh?: number | null
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
            foreignKeyName: "lead_quotes_profile_key_fkey"
            columns: ["profile_key"]
            isOneToOne: false
            referencedRelation: "profile_capture_factors"
            referencedColumns: ["profile_key"]
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
      lead_submission_throttle: {
        Row: {
          blocked_until: string | null
          count: number
          ip_hash: string
          window_start: string
        }
        Insert: {
          blocked_until?: string | null
          count?: number
          ip_hash: string
          window_start?: string
        }
        Update: {
          blocked_until?: string | null
          count?: number
          ip_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          company_name: string
          consumer_type: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          converted_client_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          est_annual_mwh: number | null
          est_value_eur: number | null
          id: string
          lost_reason: string | null
          notes: string | null
          organization_id: string
          owner: string | null
          pod_code: string | null
          source: string | null
          stage: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          company_name: string
          consumer_type?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_client_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          est_annual_mwh?: number | null
          est_value_eur?: number | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          organization_id?: string
          owner?: string | null
          pod_code?: string | null
          source?: string | null
          stage?: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string
          consumer_type?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_client_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          est_annual_mwh?: number | null
          est_value_eur?: number | null
          id?: string
          lost_reason?: string | null
          notes?: string | null
          organization_id?: string
          owner?: string | null
          pod_code?: string | null
          source?: string | null
          stage?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      load_history: {
        Row: {
          created_at: string
          id: string
          load_mw: number
          organization_id: string
          source: string
          timestamp: string
          zone: string
        }
        Insert: {
          created_at?: string
          id?: string
          load_mw: number
          organization_id: string
          source?: string
          timestamp: string
          zone: string
        }
        Update: {
          created_at?: string
          id?: string
          load_mw?: number
          organization_id?: string
          source?: string
          timestamp?: string
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      market_price_history: {
        Row: {
          available_at: string
          id: string
          organization_id: string
          price_eur_mwh: number
          product: string
          source: string
          timestamp: string
          volume_mwh: number | null
          zone: string
        }
        Insert: {
          available_at?: string
          id?: string
          organization_id: string
          price_eur_mwh: number
          product: string
          source?: string
          timestamp: string
          volume_mwh?: number | null
          zone?: string
        }
        Update: {
          available_at?: string
          id?: string
          organization_id?: string
          price_eur_mwh?: number
          product?: string
          source?: string
          timestamp?: string
          volume_mwh?: number | null
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_price_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          source: string
        }
        Insert: {
          created_at?: string
          delivery_at: string
          id?: string
          price_eur_mwh: number
          source?: string
        }
        Update: {
          created_at?: string
          delivery_at?: string
          id?: string
          price_eur_mwh?: number
          source?: string
        }
        Relationships: []
      }
      meter_load_profiles: {
        Row: {
          day_type: string
          hour: number
          metering_point_id: string
          sample_days: number
          season: string
          share: number
          updated_at: string
        }
        Insert: {
          day_type: string
          hour: number
          metering_point_id: string
          sample_days: number
          season: string
          share: number
          updated_at?: string
        }
        Update: {
          day_type?: string
          hour?: number
          metering_point_id?: string
          sample_days?: number
          season?: string
          share?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meter_load_profiles_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
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
          balance_group_id: string | null
          calibration_months: number
          calibration_updated_at: string | null
          capacity_kw: number | null
          client_id: string
          connected_power_kw: number | null
          connection_type: string | null
          consumer_category: string
          consumer_type: Database["public"]["Enums"]["consumer_type"] | null
          created_at: string
          dso_area: string | null
          dso_meter_id: string | null
          edu_code: string
          eic_code: string | null
          eic_metering_id: string | null
          has_private_meter: boolean
          has_pv: boolean
          id: string
          is_prosumer: boolean
          kimi_meter_id: number | null
          latitude: number | null
          longitude: number | null
          meter_id: string | null
          metering_category:
            | Database["public"]["Enums"]["metering_category"]
            | null
          notes: string | null
          producer_party_eic: string | null
          prosumer_scheme: Database["public"]["Enums"]["prosumer_scheme"] | null
          pv_azimuth_deg: number | null
          pv_calibration: number
          pv_capacity_kw: number | null
          pv_tilt_deg: number | null
          slp_category: Database["public"]["Enums"]["slp_category"] | null
          slp_profile_code: string | null
          smart_meter_calibration: number
          status: string
          tariff_type: string | null
          voltage_level: string | null
        }
        Insert: {
          address?: string | null
          annual_consumption_mwh?: number | null
          balance_group_id?: string | null
          calibration_months?: number
          calibration_updated_at?: string | null
          capacity_kw?: number | null
          client_id: string
          connected_power_kw?: number | null
          connection_type?: string | null
          consumer_category?: string
          consumer_type?: Database["public"]["Enums"]["consumer_type"] | null
          created_at?: string
          dso_area?: string | null
          dso_meter_id?: string | null
          edu_code: string
          eic_code?: string | null
          eic_metering_id?: string | null
          has_private_meter?: boolean
          has_pv?: boolean
          id?: string
          is_prosumer?: boolean
          kimi_meter_id?: number | null
          latitude?: number | null
          longitude?: number | null
          meter_id?: string | null
          metering_category?:
            | Database["public"]["Enums"]["metering_category"]
            | null
          notes?: string | null
          producer_party_eic?: string | null
          prosumer_scheme?:
            | Database["public"]["Enums"]["prosumer_scheme"]
            | null
          pv_azimuth_deg?: number | null
          pv_calibration?: number
          pv_capacity_kw?: number | null
          pv_tilt_deg?: number | null
          slp_category?: Database["public"]["Enums"]["slp_category"] | null
          slp_profile_code?: string | null
          smart_meter_calibration?: number
          status?: string
          tariff_type?: string | null
          voltage_level?: string | null
        }
        Update: {
          address?: string | null
          annual_consumption_mwh?: number | null
          balance_group_id?: string | null
          calibration_months?: number
          calibration_updated_at?: string | null
          capacity_kw?: number | null
          client_id?: string
          connected_power_kw?: number | null
          connection_type?: string | null
          consumer_category?: string
          consumer_type?: Database["public"]["Enums"]["consumer_type"] | null
          created_at?: string
          dso_area?: string | null
          dso_meter_id?: string | null
          edu_code?: string
          eic_code?: string | null
          eic_metering_id?: string | null
          has_private_meter?: boolean
          has_pv?: boolean
          id?: string
          is_prosumer?: boolean
          kimi_meter_id?: number | null
          latitude?: number | null
          longitude?: number | null
          meter_id?: string | null
          metering_category?:
            | Database["public"]["Enums"]["metering_category"]
            | null
          notes?: string | null
          producer_party_eic?: string | null
          prosumer_scheme?:
            | Database["public"]["Enums"]["prosumer_scheme"]
            | null
          pv_azimuth_deg?: number | null
          pv_calibration?: number
          pv_capacity_kw?: number | null
          pv_tilt_deg?: number | null
          slp_category?: Database["public"]["Enums"]["slp_category"] | null
          slp_profile_code?: string | null
          smart_meter_calibration?: number
          status?: string
          tariff_type?: string | null
          voltage_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metering_points_balance_group_id_fkey"
            columns: ["balance_group_id"]
            isOneToOne: false
            referencedRelation: "balance_groups"
            referencedColumns: ["id"]
          },
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
          created_by: string | null
          id: string
          notes: string | null
          organization_id: string
          price_eur_mwh: number
          side: string
          trade_date: string
          volume_mwh: number
        }
        Insert: {
          balancing_cost_eur?: number
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          price_eur_mwh: number
          side: string
          trade_date: string
          volume_mwh: number
        }
        Update: {
          balancing_cost_eur?: number
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          price_eur_mwh?: number
          side?: string
          trade_date?: string
          volume_mwh?: number
        }
        Relationships: [
          {
            foreignKeyName: "nominations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          alerts: boolean
          billing: boolean
          cheapest_slot: boolean
          created_at: string
          ev: boolean
          outage: boolean
          savings: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          alerts?: boolean
          billing?: boolean
          cheapest_slot?: boolean
          created_at?: string
          ev?: boolean
          outage?: boolean
          savings?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          alerts?: boolean
          billing?: boolean
          cheapest_slot?: boolean
          created_at?: string
          ev?: boolean
          outage?: boolean
          savings?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          delivered: boolean
          id: string
          read_at: string | null
          title: string
          topic: string
          url: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          delivered?: boolean
          id?: string
          read_at?: string | null
          title: string
          topic: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          delivered?: boolean
          id?: string
          read_at?: string | null
          title?: string
          topic?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      org_risk_settings: {
        Row: {
          bess_capex_eur_kwh: number
          bess_max_cycles_per_day: number
          capital_at_risk_eur: number
          cvar_beta: number
          forecast_horizon_hours: number
          forecast_retrain_days: number
          id: string
          margin_target_eur_mwh: number
          max_open_position_pct: number
          min_hedge_ratio: number
          organization_id: string
          risk_aversion_lambda: number
          updated_at: string
          updated_by: string | null
          volume_sigma_default: number
        }
        Insert: {
          bess_capex_eur_kwh?: number
          bess_max_cycles_per_day?: number
          capital_at_risk_eur?: number
          cvar_beta?: number
          forecast_horizon_hours?: number
          forecast_retrain_days?: number
          id?: string
          margin_target_eur_mwh?: number
          max_open_position_pct?: number
          min_hedge_ratio?: number
          organization_id: string
          risk_aversion_lambda?: number
          updated_at?: string
          updated_by?: string | null
          volume_sigma_default?: number
        }
        Update: {
          bess_capex_eur_kwh?: number
          bess_max_cycles_per_day?: number
          capital_at_risk_eur?: number
          cvar_beta?: number
          forecast_horizon_hours?: number
          forecast_retrain_days?: number
          id?: string
          margin_target_eur_mwh?: number
          max_open_position_pct?: number
          min_hedge_ratio?: number
          organization_id?: string
          risk_aversion_lambda?: number
          updated_at?: string
          updated_by?: string | null
          volume_sigma_default?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_risk_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          is_default: boolean
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_default?: boolean
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_default?: boolean
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_line: string | null
          bank_name: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country_code: string | null
          created_at: string
          default_currency: string
          eic_code: string | null
          iban: string | null
          id: string
          invoice_footer_note: string | null
          invoice_sender_email: string | null
          legal_name: string | null
          licence_number: string | null
          name: string
          postal_code: string | null
          registration_number: string | null
          short_name: string | null
          swift: string | null
          tax_id: string | null
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address_line?: string | null
          bank_name?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          default_currency?: string
          eic_code?: string | null
          iban?: string | null
          id?: string
          invoice_footer_note?: string | null
          invoice_sender_email?: string | null
          legal_name?: string | null
          licence_number?: string | null
          name: string
          postal_code?: string | null
          registration_number?: string | null
          short_name?: string | null
          swift?: string | null
          tax_id?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address_line?: string | null
          bank_name?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          default_currency?: string
          eic_code?: string | null
          iban?: string | null
          id?: string
          invoice_footer_note?: string | null
          invoice_sender_email?: string | null
          legal_name?: string | null
          licence_number?: string | null
          name?: string
          postal_code?: string | null
          registration_number?: string | null
          short_name?: string | null
          swift?: string | null
          tax_id?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
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
          created_by: string | null
          currency: string
          id: string
          method: string
          notes: string | null
          organization_id: string
          paid_at: string
          status: string
        }
        Insert: {
          amount_eur: number
          bank_reference?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          status?: string
        }
        Update: {
          amount_eur?: number
          bank_reference?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          created_by: string | null
          currency: string
          end_date: string
          fixed_price_eur_mwh: number
          floor_price_eur_mwh: number | null
          id: string
          metering_point_id: string | null
          notes: string | null
          organization_id: string
          ppa_code: string
          ppa_type: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          buyback_price_eur_mwh?: number | null
          ceiling_price_eur_mwh?: number | null
          client_id: string
          contracted_volume_mwh?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date: string
          fixed_price_eur_mwh: number
          floor_price_eur_mwh?: number | null
          id?: string
          metering_point_id?: string | null
          notes?: string | null
          organization_id?: string
          ppa_code: string
          ppa_type: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          buyback_price_eur_mwh?: number | null
          ceiling_price_eur_mwh?: number | null
          client_id?: string
          contracted_volume_mwh?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string
          fixed_price_eur_mwh?: number
          floor_price_eur_mwh?: number | null
          id?: string
          metering_point_id?: string | null
          notes?: string | null
          organization_id?: string
          ppa_code?: string
          ppa_type?: string
          start_date?: string
          status?: string
          updated_at?: string
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
          {
            foreignKeyName: "ppa_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      ppee_coefficients: {
        Row: {
          coefficient_pct: number
          created_at: string
          delivery_date: string
          hour: number
          is_final: boolean
          source: string
        }
        Insert: {
          coefficient_pct: number
          created_at?: string
          delivery_date: string
          hour: number
          is_final?: boolean
          source?: string
        }
        Update: {
          coefficient_pct?: number
          created_at?: string
          delivery_date?: string
          hour?: number
          is_final?: boolean
          source?: string
        }
        Relationships: []
      }
      profile_capture_factors: {
        Row: {
          capture_factor: number
          measured_from: string
          measured_to: string
          n_hours: number
          note: string | null
          profile_key: string
          updated_at: string
        }
        Insert: {
          capture_factor: number
          measured_from: string
          measured_to: string
          n_hours: number
          note?: string | null
          profile_key: string
          updated_at?: string
        }
        Update: {
          capture_factor?: number
          measured_from?: string
          measured_to?: string
          n_hours?: number
          note?: string | null
          profile_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          holiday_date: string
          name: string
        }
        Insert: {
          holiday_date: string
          name: string
        }
        Update: {
          holiday_date?: string
          name?: string
        }
        Relationships: []
      }
      pv_forecasts: {
        Row: {
          created_at: string
          forecast_kwh: number
          ghi_wm2: number | null
          id: string
          metering_point_id: string
          source: string
          temp_c: number | null
          ts: string
        }
        Insert: {
          created_at?: string
          forecast_kwh: number
          ghi_wm2?: number | null
          id?: string
          metering_point_id: string
          source?: string
          temp_c?: number | null
          ts: string
        }
        Update: {
          created_at?: string
          forecast_kwh?: number
          ghi_wm2?: number | null
          id?: string
          metering_point_id?: string
          source?: string
          temp_c?: number | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_forecasts_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
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
      regulatory_charges: {
        Row: {
          code: string
          created_at: string
          id: string
          label: string
          unit: string
          valid_from: string
          valid_to: string | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          label: string
          unit: string
          valid_from: string
          valid_to?: string | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          label?: string
          unit?: string
          valid_from?: string
          valid_to?: string | null
          value?: number
        }
        Relationships: []
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
          created_by: string | null
          delivery_date: string
          id: string
          message_log: Json
          notes: string | null
          organization_id: string
          response_at: string | null
          schedule_number: string
          status: string
          submitted_at: string | null
          tso_area: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_date: string
          id?: string
          message_log?: Json
          notes?: string | null
          organization_id?: string
          response_at?: string | null
          schedule_number: string
          status?: string
          submitted_at?: string | null
          tso_area: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_date?: string
          id?: string
          message_log?: Json
          notes?: string | null
          organization_id?: string
          response_at?: string | null
          schedule_number?: string
          status?: string
          submitted_at?: string | null
          tso_area?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          created_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          metering_point_id: string | null
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metering_point_id?: string | null
          name: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          metering_point_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          created_by: string | null
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string
          payment_terms_days: number
          start_date: string
          status: string
          tariff_id: string | null
          updated_at: string
        }
        Insert: {
          annual_volume_mwh?: number | null
          auto_renew?: boolean
          client_id: string
          contract_number: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          start_date: string
          status?: string
          tariff_id?: string | null
          updated_at?: string
        }
        Update: {
          annual_volume_mwh?: number | null
          auto_renew?: boolean
          client_id?: string
          contract_number?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          start_date?: string
          status?: string
          tariff_id?: string | null
          updated_at?: string
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
            foreignKeyName: "supply_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      switch_requests: {
        Row: {
          client_id: string | null
          confirmed_date: string | null
          created_at: string
          created_by: string | null
          current_supplier: string | null
          direction: string
          dso_status: string
          edu_code: string
          id: string
          lost_reason: string | null
          message_envelope: string | null
          new_supplier: string | null
          notes: string | null
          organization_id: string
          requested_date: string | null
          updated_at: string
          volume_estimate_mwh: number | null
          win_back_discount_eur_mwh: number | null
          win_back_offered: boolean | null
        }
        Insert: {
          client_id?: string | null
          confirmed_date?: string | null
          created_at?: string
          created_by?: string | null
          current_supplier?: string | null
          direction: string
          dso_status?: string
          edu_code: string
          id?: string
          lost_reason?: string | null
          message_envelope?: string | null
          new_supplier?: string | null
          notes?: string | null
          organization_id?: string
          requested_date?: string | null
          updated_at?: string
          volume_estimate_mwh?: number | null
          win_back_discount_eur_mwh?: number | null
          win_back_offered?: boolean | null
        }
        Update: {
          client_id?: string | null
          confirmed_date?: string | null
          created_at?: string
          created_by?: string | null
          current_supplier?: string | null
          direction?: string
          dso_status?: string
          edu_code?: string
          id?: string
          lost_reason?: string | null
          message_envelope?: string | null
          new_supplier?: string | null
          notes?: string | null
          organization_id?: string
          requested_date?: string | null
          updated_at?: string
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
          {
            foreignKeyName: "switch_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          created_by: string | null
          currency: string
          customer_segment: string | null
          id: string
          model: string
          name: string
          notes: string | null
          organization_id: string
          status: string
          updated_at: string
          valid_from: string
          valid_to: string | null
          vat_included: boolean
        }
        Insert: {
          code: string
          components?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_segment?: string | null
          id?: string
          model?: string
          name: string
          notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          valid_from: string
          valid_to?: string | null
          vat_included?: boolean
        }
        Update: {
          code?: string
          components?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_segment?: string | null
          id?: string
          model?: string
          name?: string
          notes?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          vat_included?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          capacity_agreement_id: string | null
          counterparty_id: string | null
          created_at: string
          created_by: string | null
          delivery_end: string
          delivery_start: string
          ess_business_type: string | null
          ess_series_id: string | null
          hub: string | null
          id: string
          in_area_eic: string | null
          market: string
          mtu_shape: Json | null
          notes: string | null
          organization_id: string
          out_area_eic: string | null
          price_eur_mwh: number
          schedulable: boolean
          shape_hours: number[] | null
          shape_key: string
          side: string
          status: string
          supply_contract_id: string | null
          total_value_eur: number | null
          trade_number: string
          trader: string | null
          trading_contract_id: string | null
          updated_at: string
          volume_mwh: number
        }
        Insert: {
          capacity_agreement_id?: string | null
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_end: string
          delivery_start: string
          ess_business_type?: string | null
          ess_series_id?: string | null
          hub?: string | null
          id?: string
          in_area_eic?: string | null
          market?: string
          mtu_shape?: Json | null
          notes?: string | null
          organization_id?: string
          out_area_eic?: string | null
          price_eur_mwh: number
          schedulable?: boolean
          shape_hours?: number[] | null
          shape_key?: string
          side: string
          status?: string
          supply_contract_id?: string | null
          total_value_eur?: number | null
          trade_number: string
          trader?: string | null
          trading_contract_id?: string | null
          updated_at?: string
          volume_mwh: number
        }
        Update: {
          capacity_agreement_id?: string | null
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_end?: string
          delivery_start?: string
          ess_business_type?: string | null
          ess_series_id?: string | null
          hub?: string | null
          id?: string
          in_area_eic?: string | null
          market?: string
          mtu_shape?: Json | null
          notes?: string | null
          organization_id?: string
          out_area_eic?: string | null
          price_eur_mwh?: number
          schedulable?: boolean
          shape_hours?: number[] | null
          shape_key?: string
          side?: string
          status?: string
          supply_contract_id?: string | null
          total_value_eur?: number | null
          trade_number?: string
          trader?: string | null
          trading_contract_id?: string | null
          updated_at?: string
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
            foreignKeyName: "trades_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_supply_contract_id_fkey"
            columns: ["supply_contract_id"]
            isOneToOne: false
            referencedRelation: "supply_contracts"
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
          created_by: string | null
          currency: string
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string
          signed_date: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          contract_number: string
          contract_type?: string
          counterparty_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          signed_date?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          contract_number?: string
          contract_type?: string
          counterparty_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          signed_date?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_contracts_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trading_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      volume_forecast_daily: {
        Row: {
          calibration: number
          created_at: string
          day_type: string
          forecast_date: string
          forecast_mwh: number
          metering_point_id: string
          method: string
          sample_days: number
        }
        Insert: {
          calibration?: number
          created_at?: string
          day_type: string
          forecast_date: string
          forecast_mwh: number
          metering_point_id: string
          method: string
          sample_days?: number
        }
        Update: {
          calibration?: number
          created_at?: string
          day_type?: string
          forecast_date?: string
          forecast_mwh?: number
          metering_point_id?: string
          method?: string
          sample_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "volume_forecast_daily_metering_point_id_fkey"
            columns: ["metering_point_id"]
            isOneToOne: false
            referencedRelation: "metering_points"
            referencedColumns: ["id"]
          },
        ]
      }
      volume_forecasts: {
        Row: {
          client_id: string | null
          consumed_to_date_mwh: number
          created_at: string
          forecast_mwh: number
          id: string
          method: string
          month: string
          scope: string
          segment: Database["public"]["Enums"]["schedule_leg"] | null
          slp_category: Database["public"]["Enums"]["slp_category"] | null
        }
        Insert: {
          client_id?: string | null
          consumed_to_date_mwh?: number
          created_at?: string
          forecast_mwh: number
          id?: string
          method?: string
          month: string
          scope: string
          segment?: Database["public"]["Enums"]["schedule_leg"] | null
          slp_category?: Database["public"]["Enums"]["slp_category"] | null
        }
        Update: {
          client_id?: string | null
          consumed_to_date_mwh?: number
          created_at?: string
          forecast_mwh?: number
          id?: string
          method?: string
          month?: string
          scope?: string
          segment?: Database["public"]["Enums"]["schedule_leg"] | null
          slp_category?: Database["public"]["Enums"]["slp_category"] | null
        }
        Relationships: [
          {
            foreignKeyName: "volume_forecasts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_forecast_accuracy: {
        Row: {
          bias: number | null
          coverage_p10_p90: number | null
          last_scored_at: string | null
          mae: number | null
          model_kind: string | null
          n: number | null
          organization_id: string | null
          rmse: number | null
          smape: number | null
          zone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_predictions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_hedge_breaches: {
        Row: {
          delivery_date: string | null
          hedge_ratio: number | null
          net_open_mwh: number | null
          total_long_mwh: number | null
          total_short_mwh: number | null
          worst_hour: number | null
          worst_open_mwh: number | null
        }
        Relationships: []
      }
      v_hourly_position: {
        Row: {
          bought_mwh: number | null
          delivery_date: string | null
          hour_of_day: number | null
          open_mwh: number | null
          sold_mwh: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      allocate_invoice_number: {
        Args: { p_fiscal_year: number }
        Returns: string
      }
      check_lead_throttle: {
        Args: {
          p_block_minutes?: number
          p_ip_hash: string
          p_max_per_window?: number
          p_window_minutes?: number
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      current_org_id: { Args: never; Returns: string }
      current_portal_client_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
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
      is_org_member: { Args: { p_org: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      issue_billing_run: {
        Args: { p_run_id: string }
        Returns: {
          invoice_id: string
          invoice_number: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_invoice_number: { Args: never; Returns: string }
      prune_lead_throttle: { Args: never; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      regulatory_value_for: {
        Args: { p_code: string; p_period_start: string }
        Returns: number
      }
      shape_mask: {
        Args: { p_hours: number[]; p_key: string }
        Returns: number[]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
