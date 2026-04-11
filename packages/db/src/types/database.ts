export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agencies: {
        Row: {
          acronym: string | null
          agency_type: string
          contact_email: string | null
          created_at: string
          description: string | null
          governing_body_id: string | null
          id: string
          is_active: boolean
          jurisdiction_id: string
          metadata: Json
          name: string
          parent_agency_id: string | null
          short_name: string | null
          source_ids: Json
          updated_at: string
          usaspending_agency_id: string | null
          usaspending_subtier_id: string | null
          website_url: string | null
        }
        Insert: {
          acronym?: string | null
          agency_type?: string
          contact_email?: string | null
          created_at?: string
          description?: string | null
          governing_body_id?: string | null
          id?: string
          is_active?: boolean
          jurisdiction_id: string
          metadata?: Json
          name: string
          parent_agency_id?: string | null
          short_name?: string | null
          source_ids?: Json
          updated_at?: string
          usaspending_agency_id?: string | null
          usaspending_subtier_id?: string | null
          website_url?: string | null
        }
        Update: {
          acronym?: string | null
          agency_type?: string
          contact_email?: string | null
          created_at?: string
          description?: string | null
          governing_body_id?: string | null
          id?: string
          is_active?: boolean
          jurisdiction_id?: string
          metadata?: Json
          name?: string
          parent_agency_id?: string | null
          short_name?: string | null
          source_ids?: Json
          updated_at?: string
          usaspending_agency_id?: string | null
          usaspending_subtier_id?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agencies_governing_body_id_fkey"
            columns: ["governing_body_id"]
            isOneToOne: false
            referencedRelation: "governing_bodies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agencies_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agencies_parent_agency_id_fkey"
            columns: ["parent_agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_summary_cache: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          model: string
          summary_text: string
          summary_type: string
          tokens_used: number | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          model: string
          summary_text: string
          summary_type: string
          tokens_used?: number | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          model?: string
          summary_text?: string
          summary_type?: string
          tokens_used?: number | null
        }
        Relationships: []
      }
      api_usage_logs: {
        Row: {
          cost_cents: number
          created_at: string
          endpoint: string | null
          id: string
          input_tokens: number | null
          metadata: Json
          model: string | null
          output_tokens: number | null
          service: string
          tokens_used: number | null
        }
        Insert: {
          cost_cents?: number
          created_at?: string
          endpoint?: string | null
          id?: string
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          output_tokens?: number | null
          service: string
          tokens_used?: number | null
        }
        Update: {
          cost_cents?: number
          created_at?: string
          endpoint?: string | null
          id?: string
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          output_tokens?: number | null
          service?: string
          tokens_used?: number | null
        }
        Relationships: []
      }
      career_history: {
        Row: {
          created_at: string
          ended_at: string | null
          governing_body_id: string | null
          id: string
          is_government: boolean
          metadata: Json
          official_id: string
          organization: string
          revolving_door_explanation: string | null
          revolving_door_flag: boolean
          role_title: string | null
          started_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          governing_body_id?: string | null
          id?: string
          is_government?: boolean
          metadata?: Json
          official_id: string
          organization: string
          revolving_door_explanation?: string | null
          revolving_door_flag?: boolean
          role_title?: string | null
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          governing_body_id?: string | null
          id?: string
          is_government?: boolean
          metadata?: Json
          official_id?: string
          organization?: string
          revolving_door_explanation?: string | null
          revolving_door_flag?: boolean
          role_title?: string | null
          started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_history_governing_body_id_fkey"
            columns: ["governing_body_id"]
            isOneToOne: false
            referencedRelation: "governing_bodies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_history_official_id_fkey"
            columns: ["official_id"]
            isOneToOne: false
            referencedRelation: "officials"
            referencedColumns: ["id"]
          },
        ]
      }
      civic_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          is_deleted: boolean
          metadata: Json
          onchain_tx_hash: string | null
          parent_id: string | null
          position: string | null
          proposal_id: string
          updated_at: string
          upvotes: number
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          metadata?: Json
          onchain_tx_hash?: string | null
          parent_id?: string | null
          position?: string | null
          proposal_id: string
          updated_at?: string
          upvotes?: number
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          metadata?: Json
          onchain_tx_hash?: string | null
          parent_id?: string | null
          position?: string | null
          proposal_id?: string
          updated_at?: string
          upvotes?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "civic_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "civic_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civic_comments_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      civic_credit_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          onchain_tx_hash: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          onchain_tx_hash?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          onchain_tx_hash?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          transaction_type?: string
          user_id?: string
        }
        Relationships: []
      }
      civic_initiative_responses: {
        Row: {
          body_text: string | null
          committee_referred: string | null
          created_at: string
          id: string
          initiative_id: string
          is_verified_staff: boolean
          official_id: string
          responded_at: string | null
          response_type: Database["public"]["Enums"]["official_response_type"]
          window_closes_at: string
          window_opened_at: string
        }
        Insert: {
          body_text?: string | null
          committee_referred?: string | null
          created_at?: string
          id?: string
          initiative_id: string
          is_verified_staff?: boolean
          official_id: string
          responded_at?: string | null
          response_type?: Database["public"]["Enums"]["official_response_type"]
          window_closes_at?: string
          window_opened_at?: string
        }
        Update: {
          body_text?: string | null
          committee_referred?: string | null
          created_at?: string
          id?: string
          initiative_id?: string
          is_verified_staff?: boolean
          official_id?: string
          responded_at?: string | null
          response_type?: Database["public"]["Enums"]["official_response_type"]
          window_closes_at?: string
          window_opened_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "civic_initiative_responses_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "civic_initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civic_initiative_responses_official_id_fkey"
            columns: ["official_id"]
            isOneToOne: false
            referencedRelation: "officials"
            referencedColumns: ["id"]
          },
        ]
      }
      civic_initiative_signatures: {
        Row: {
          district: string | null
          id: string
          initiative_id: string
          signed_at: string
          user_id: string
          verification_tier: Database["public"]["Enums"]["signature_verification"]
        }
        Insert: {
          district?: string | null
          id?: string
          initiative_id: string
          signed_at?: string
          user_id: string
          verification_tier?: Database["public"]["Enums"]["signature_verification"]
        }
        Update: {
          district?: string | null
          id?: string
          initiative_id?: string
          signed_at?: string
          user_id?: string
          verification_tier?: Database["public"]["Enums"]["signature_verification"]
        }
        Relationships: [
          {
            foreignKeyName: "civic_initiative_signatures_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "civic_initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civic_initiative_signatures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      civic_initiatives: {
        Row: {
          authorship_type: Database["public"]["Enums"]["initiative_authorship"]
          body_md: string
          created_at: string
          id: string
          issue_area_tags: string[]
          linked_proposal_id: string | null
          mobilise_started_at: string | null
          primary_author_id: string | null
          quality_gate_score: Json
          resolution_type:
            | Database["public"]["Enums"]["initiative_resolution"]
            | null
          resolved_at: string | null
          scope: Database["public"]["Enums"]["initiative_scope"]
          stage: Database["public"]["Enums"]["initiative_stage"]
          summary: string | null
          target_district: string | null
          title: string
          updated_at: string
        }
        Insert: {
          authorship_type?: Database["public"]["Enums"]["initiative_authorship"]
          body_md: string
          created_at?: string
          id?: string
          issue_area_tags?: string[]
          linked_proposal_id?: string | null
          mobilise_started_at?: string | null
          primary_author_id?: string | null
          quality_gate_score?: Json
          resolution_type?:
            | Database["public"]["Enums"]["initiative_resolution"]
            | null
          resolved_at?: string | null
          scope?: Database["public"]["Enums"]["initiative_scope"]
          stage?: Database["public"]["Enums"]["initiative_stage"]
          summary?: string | null
          target_district?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          authorship_type?: Database["public"]["Enums"]["initiative_authorship"]
          body_md?: string
          created_at?: string
          id?: string
          issue_area_tags?: string[]
          linked_proposal_id?: string | null
          mobilise_started_at?: string | null
          primary_author_id?: string | null
          quality_gate_score?: Json
          resolution_type?:
            | Database["public"]["Enums"]["initiative_resolution"]
            | null
          resolved_at?: string | null
          scope?: Database["public"]["Enums"]["initiative_scope"]
          stage?: Database["public"]["Enums"]["initiative_stage"]
          summary?: string | null
          target_district?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "civic_initiatives_linked_proposal_id_fkey"
            columns: ["linked_proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civic_initiatives_primary_author_id_fkey"
            columns: ["primary_author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sync_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          estimated_mb: number | null
          id: string
          metadata: Json
          pipeline: string
          rows_failed: number
          rows_inserted: number
          rows_updated: number
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          estimated_mb?: number | null
          id?: string
          metadata?: Json
          pipeline: string
          rows_failed?: number
          rows_inserted?: number
          rows_updated?: number
          started_at?: string
          status: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          estimated_mb?: number | null
          id?: string
          metadata?: Json
          pipeline?: string
          rows_failed?: number
          rows_inserted?: number
          rows_updated?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      entity_connections: {
        Row: {
          amount_cents: number | null
          connection_type: Database["public"]["Enums"]["connection_type"]
          created_at: string
          ended_at: string | null
          evidence: Json
          from_id: string
          from_type: string
          id: string
          is_verified: boolean
          metadata: Json
          occurred_at: string | null
          strength: number
          to_id: string
          to_type: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          connection_type: Database["public"]["Enums"]["connection_type"]
          created_at?: string
          ended_at?: string | null
          evidence?: Json
          from_id: string
          from_type: string
          id?: string
          is_verified?: boolean
          metadata?: Json
          occurred_at?: string | null
          strength?: number
          to_id: string
          to_type: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          connection_type?: Database["public"]["Enums"]["connection_type"]
          created_at?: string
          ended_at?: string | null
          evidence?: Json
          from_id?: string
          from_type?: string
          id?: string
          is_verified?: boolean
          metadata?: Json
          occurred_at?: string | null
          strength?: number
          to_id?: string
          to_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      entity_tags: {
        Row: {
          ai_model: string | null
          confidence: number | null
          created_at: string | null
          display_icon: string | null
          display_label: string
          entity_id: string
          entity_type: string
          generated_by: string
          id: string
          metadata: Json | null
          pipeline_version: string | null
          tag: string
          tag_category: string
          visibility: string
        }
        Insert: {
          ai_model?: string | null
          confidence?: number | null
          created_at?: string | null
          display_icon?: string | null
          display_label: string
          entity_id: string
          entity_type: string
          generated_by: string
          id?: string
          metadata?: Json | null
          pipeline_version?: string | null
          tag: string
          tag_category: string
          visibility?: string
        }
        Update: {
          ai_model?: string | null
          confidence?: number | null
          created_at?: string | null
          display_icon?: string | null
          display_label?: string
          entity_id?: string
          entity_type?: string
          generated_by?: string
          id?: string
          metadata?: Json | null
          pipeline_version?: string | null
          tag?: string
          tag_category?: string
          visibility?: string
        }
        Relationships: []
      }
      financial_entities: {
        Row: {
          created_at: string
          entity_type: string
          id: string
          industry: string | null
          metadata: Json
          name: string
          source_ids: Json
          total_donated_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          id?: string
          industry?: string | null
          metadata?: Json
          name: string
          source_ids?: Json
          total_donated_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          id?: string
          industry?: string | null
          metadata?: Json
          name?: string
          source_ids?: Json
          total_donated_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      financial_relationships: {
        Row: {
          amount_cents: number
          contribution_date: string | null
          created_at: string
          cycle_year: number | null
          donor_name: string
          donor_type: Database["public"]["Enums"]["donor_type"]
          fec_committee_id: string | null
          fec_filing_id: string | null
          governing_body_id: string | null
          id: string
          industry: string | null
          is_bundled: boolean
          metadata: Json
          official_id: string | null
          source_ids: Json
          source_url: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          contribution_date?: string | null
          created_at?: string
          cycle_year?: number | null
          donor_name: string
          donor_type: Database["public"]["Enums"]["donor_type"]
          fec_committee_id?: string | null
          fec_filing_id?: string | null
          governing_body_id?: string | null
          id?: string
          industry?: string | null
          is_bundled?: boolean
          metadata?: Json
          official_id?: string | null
          source_ids?: Json
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          contribution_date?: string | null
          created_at?: string
          cycle_year?: number | null
          donor_name?: string
          donor_type?: Database["public"]["Enums"]["donor_type"]
          fec_committee_id?: string | null
          fec_filing_id?: string | null
          governing_body_id?: string | null
          id?: string
          industry?: string | null
          is_bundled?: boolean
          metadata?: Json
          official_id?: string | null
          source_ids?: Json
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_relationships_governing_body_id_fkey"
            columns: ["governing_body_id"]
            isOneToOne: false
            referencedRelation: "governing_bodies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_relationships_official_id_fkey"
            columns: ["official_id"]
            isOneToOne: false
            referencedRelation: "officials"
            referencedColumns: ["id"]
          },
        ]
      }
      governing_bodies: {
        Row: {
          contact_email: string | null
          created_at: string
          id: string
          is_active: boolean
          jurisdiction_id: string
          metadata: Json
          name: string
          seat_count: number | null
          short_name: string | null
          term_length_years: number | null
          type: Database["public"]["Enums"]["governing_body_type"]
          updated_at: string
          website_url: string | null
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          jurisdiction_id: string
          metadata?: Json
          name: string
          seat_count?: number | null
          short_name?: string | null
          term_length_years?: number | null
          type: Database["public"]["Enums"]["governing_body_type"]
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          jurisdiction_id?: string
          metadata?: Json
          name?: string
          seat_count?: number | null
          short_name?: string | null
          term_length_years?: number | null
          type?: Database["public"]["Enums"]["governing_body_type"]
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governing_bodies_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
        ]
      }
      graph_snapshots: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_public: boolean
          state: Json
          title: string | null
          view_count: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_public?: boolean
          state: Json
          title?: string | null
          view_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_public?: b