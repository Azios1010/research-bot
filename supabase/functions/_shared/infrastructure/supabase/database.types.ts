export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      rr_accept_telegram_update: {
        Args: {
          p_action: Json;
          p_bot_id: string;
          p_target: string;
          p_update_id: number;
        };
        Returns: Json;
      };
      rr_apply_feedback: {
        Args: {
          p_action: string;
          p_context?: Json;
          p_generation?: number;
          p_idempotency_key: string;
          p_opportunity: string;
          p_owner?: string;
          p_profile: string;
          p_task?: string;
        };
        Returns: Database["radar"]["Tables"]["user_opportunity_state"]["Row"];
        SetofOptions: {
          from: "*";
          to: "user_opportunity_state";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_begin_interaction_send: {
        Args: { p_generation: number; p_owner: string; p_task: string };
        Returns: Json;
      };
      rr_begin_notification_attempt: {
        Args: { p_generation: number; p_owner: string; p_task: string };
        Returns: Json;
      };
      rr_browse_interaction: {
        Args: { p_generation: number; p_owner: string; p_task: string };
        Returns: Json;
      };
      rr_claim_task: {
        Args: { p_kinds: string[]; p_lease_seconds?: number; p_owner: string };
        Returns: Database["radar"]["Tables"]["job_tasks"]["Row"];
        SetofOptions: {
          from: "*";
          to: "job_tasks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_commit_interaction_reply: {
        Args: {
          p_generation: number;
          p_owner: string;
          p_parts: Json;
          p_task: string;
        };
        Returns: string;
      };
      rr_commit_source_page: {
        Args: {
          p_cursor_hash: string;
          p_generation: number;
          p_next_cursor?: Json;
          p_not_modified?: boolean;
          p_owner: string;
          p_page_url: unknown;
          p_records: Json;
          p_sequence: number;
          p_source_revision?: string;
          p_task: string;
          p_validators?: Json;
        };
        Returns: Json;
      };
      rr_create_collection_run: {
        Args: {
          p_request_key: string;
          p_source_id: string;
          p_trigger_kind: string;
        };
        Returns: Database["radar"]["Tables"]["collection_runs"]["Row"];
        SetofOptions: {
          from: "*";
          to: "collection_runs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_enqueue_task: {
        Args: {
          p_available_at?: string;
          p_expires_at?: string;
          p_kind: string;
          p_payload: Json;
          p_request_key: string;
        };
        Returns: Database["radar"]["Tables"]["job_tasks"]["Row"];
        SetofOptions: {
          from: "*";
          to: "job_tasks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_execute_interaction: {
        Args: { p_generation: number; p_owner: string; p_task: string };
        Returns: Json;
      };
      rr_finish_interaction_send: {
        Args: {
          p_attempt: string;
          p_code?: string;
          p_generation: number;
          p_message?: string;
          p_outcome: string;
          p_owner: string;
          p_retry?: number;
          p_task: string;
        };
        Returns: undefined;
      };
      rr_finish_notification_attempt: {
        Args: {
          p_attempt: string;
          p_error_class?: string;
          p_generation: number;
          p_message_id?: string;
          p_outcome: string;
          p_owner: string;
          p_retry_seconds?: number;
          p_task: string;
        };
        Returns: Database["radar"]["Tables"]["notification_attempts"]["Row"];
        SetofOptions: {
          from: "*";
          to: "notification_attempts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_finish_task: {
        Args: {
          p_error_code?: string;
          p_generation: number;
          p_owner: string;
          p_result: string;
          p_retry_seconds?: number;
          p_task: string;
        };
        Returns: Database["radar"]["Tables"]["job_tasks"]["Row"];
        SetofOptions: {
          from: "*";
          to: "job_tasks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_prepare_notification: {
        Args: {
          p_due_at: string;
          p_expires_at: string;
          p_generation?: number;
          p_items: Json;
          p_kind: string;
          p_local_date?: string;
          p_owner?: string;
          p_parts: Json;
          p_profile: string;
          p_schedule_key: string;
          p_target: string;
          p_task?: string;
          p_timezone?: string;
        };
        Returns: Database["radar"]["Tables"]["notifications"]["Row"];
        SetofOptions: {
          from: "*";
          to: "notifications";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_read_assessment_context: {
        Args: { p_generation: number; p_owner: string; p_task: string };
        Returns: Json;
      };
      rr_read_candidates: {
        Args: {
          p_generation: number;
          p_owner: string;
          p_records: Json;
          p_task: string;
        };
        Returns: Json;
      };
      rr_read_collection_context: {
        Args: { p_generation: number; p_owner: string; p_task: string };
        Returns: Json;
      };
      rr_receive_telegram: {
        Args: {
          p_action: Json;
          p_bot: string;
          p_chat: string;
          p_target: string;
          p_update: string;
          p_user: string;
        };
        Returns: Json;
      };
      rr_renew_task: {
        Args: {
          p_generation: number;
          p_lease_seconds?: number;
          p_owner: string;
          p_task: string;
        };
        Returns: Database["radar"]["Tables"]["job_tasks"]["Row"];
        SetofOptions: {
          from: "*";
          to: "job_tasks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      rr_request_rerank: {
        Args: { p_profile: string; p_request_key: string };
        Returns: string;
      };
      rr_store_assessments: {
        Args: {
          p_assessments: Json;
          p_generation: number;
          p_owner: string;
          p_task: string;
        };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  radar: {
    Tables: {
      collection_runs: {
        Row: {
          accepted: number;
          adapter_version: string;
          conditional_validators: Json;
          config_version: number;
          cursor: Json | null;
          cursor_hash: string;
          duplicates: number;
          duration_ms: number | null;
          error_counts: Json;
          error_samples: Json;
          finished_at: string | null;
          heartbeat_at: string | null;
          id: string;
          inserted: number;
          page_sequence: number;
          pages_committed: number;
          records_seen: number;
          rejected: number;
          request_key: string;
          source_id: string;
          source_revision: string | null;
          started_at: string | null;
          status: string;
          trigger_kind: string;
          updated: number;
        };
        Insert: {
          accepted?: number;
          adapter_version: string;
          conditional_validators?: Json;
          config_version: number;
          cursor?: Json | null;
          cursor_hash: string;
          duplicates?: number;
          duration_ms?: number | null;
          error_counts?: Json;
          error_samples?: Json;
          finished_at?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          inserted?: number;
          page_sequence?: number;
          pages_committed?: number;
          records_seen?: number;
          rejected?: number;
          request_key: string;
          source_id: string;
          source_revision?: string | null;
          started_at?: string | null;
          status?: string;
          trigger_kind: string;
          updated?: number;
        };
        Update: {
          accepted?: number;
          adapter_version?: string;
          conditional_validators?: Json;
          config_version?: number;
          cursor?: Json | null;
          cursor_hash?: string;
          duplicates?: number;
          duration_ms?: number | null;
          error_counts?: Json;
          error_samples?: Json;
          finished_at?: string | null;
          heartbeat_at?: string | null;
          id?: string;
          inserted?: number;
          page_sequence?: number;
          pages_committed?: number;
          records_seen?: number;
          rejected?: number;
          request_key?: string;
          source_id?: string;
          source_revision?: string | null;
          started_at?: string | null;
          status?: string;
          trigger_kind?: string;
          updated?: number;
        };
        Relationships: [
          {
            foreignKeyName: "collection_runs_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
      delivery_targets: {
        Row: {
          bot_id: string;
          channel: string;
          created_at: string;
          enabled: boolean;
          external_account_id: string;
          external_chat_id: string;
          id: string;
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          bot_id: string;
          channel?: string;
          created_at?: string;
          enabled?: boolean;
          external_account_id: string;
          external_chat_id: string;
          id?: string;
          profile_id: string;
          updated_at?: string;
        };
        Update: {
          bot_id?: string;
          channel?: string;
          created_at?: string;
          enabled?: boolean;
          external_account_id?: string;
          external_chat_id?: string;
          id?: string;
          profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "delivery_targets_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "research_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_tasks: {
        Row: {
          attempts: number;
          available_at: string;
          coalescing_key: string | null;
          collection_run_id: string | null;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          id: string;
          kind: string;
          last_error_code: string | null;
          lease_generation: number;
          lease_owner: string | null;
          lease_until: string | null;
          max_attempts: number;
          payload: Json;
          payload_version: number;
          request_key: string;
          status: string;
          telegram_bot_id: string | null;
          telegram_update_id: number | null;
        };
        Insert: {
          attempts?: number;
          available_at?: string;
          coalescing_key?: string | null;
          collection_run_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          finished_at?: string | null;
          id?: string;
          kind: string;
          last_error_code?: string | null;
          lease_generation?: number;
          lease_owner?: string | null;
          lease_until?: string | null;
          max_attempts?: number;
          payload?: Json;
          payload_version?: number;
          request_key: string;
          status?: string;
          telegram_bot_id?: string | null;
          telegram_update_id?: number | null;
        };
        Update: {
          attempts?: number;
          available_at?: string;
          coalescing_key?: string | null;
          collection_run_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          finished_at?: string | null;
          id?: string;
          kind?: string;
          last_error_code?: string | null;
          lease_generation?: number;
          lease_owner?: string | null;
          lease_until?: string | null;
          max_attempts?: number;
          payload?: Json;
          payload_version?: number;
          request_key?: string;
          status?: string;
          telegram_bot_id?: string | null;
          telegram_update_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_tasks_collection_run_id_fkey";
            columns: ["collection_run_id"];
            isOneToOne: false;
            referencedRelation: "collection_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_tasks_telegram_bot_id_telegram_update_id_fkey";
            columns: ["telegram_bot_id", "telegram_update_id"];
            isOneToOne: false;
            referencedRelation: "telegram_updates";
            referencedColumns: ["bot_id", "update_id"];
          },
        ];
      };
      notification_attempts: {
        Row: {
          attempt_number: number;
          error_class: string | null;
          finished_at: string | null;
          id: string;
          lease_generation: number;
          notification_id: string;
          part_index: number;
          resolution: Json | null;
          retry_after_seconds: number | null;
          started_at: string;
          state: string;
          task_id: string;
          telegram_message_id: string | null;
        };
        Insert: {
          attempt_number: number;
          error_class?: string | null;
          finished_at?: string | null;
          id?: string;
          lease_generation: number;
          notification_id: string;
          part_index: number;
          resolution?: Json | null;
          retry_after_seconds?: number | null;
          started_at?: string;
          state: string;
          task_id: string;
          telegram_message_id?: string | null;
        };
        Update: {
          attempt_number?: number;
          error_class?: string | null;
          finished_at?: string | null;
          id?: string;
          lease_generation?: number;
          notification_id?: string;
          part_index?: number;
          resolution?: Json | null;
          retry_after_seconds?: number | null;
          started_at?: string;
          state?: string;
          task_id?: string;
          telegram_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notification_attempts_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "notifications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_attempts_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "job_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_items: {
        Row: {
          claim_active: boolean;
          created_at: string;
          deadline_id: string | null;
          deadline_revision: number | null;
          id: string;
          notification_id: string;
          opportunity_id: string;
          part_index: number;
          profile_id: string;
          purpose: string;
          reminder_offset_days: number | null;
          snapshot: Json;
        };
        Insert: {
          claim_active?: boolean;
          created_at?: string;
          deadline_id?: string | null;
          deadline_revision?: number | null;
          id?: string;
          notification_id: string;
          opportunity_id: string;
          part_index: number;
          profile_id: string;
          purpose: string;
          reminder_offset_days?: number | null;
          snapshot?: Json;
        };
        Update: {
          claim_active?: boolean;
          created_at?: string;
          deadline_id?: string | null;
          deadline_revision?: number | null;
          id?: string;
          notification_id?: string;
          opportunity_id?: string;
          part_index?: number;
          profile_id?: string;
          purpose?: string;
          reminder_offset_days?: number | null;
          snapshot?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "notification_items_deadline_id_opportunity_id_fkey";
            columns: ["deadline_id", "opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunity_deadlines";
            referencedColumns: ["id", "opportunity_id"];
          },
          {
            foreignKeyName: "notification_items_notification_id_profile_id_fkey";
            columns: ["notification_id", "profile_id"];
            isOneToOne: false;
            referencedRelation: "notifications";
            referencedColumns: ["id", "profile_id"];
          },
          {
            foreignKeyName: "notification_items_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          delivery_target_id: string;
          due_at: string;
          error_code: string | null;
          expires_at: string;
          id: string;
          kind: string;
          local_date: string | null;
          part_states: Json;
          parts: Json;
          payload_version: number;
          profile_id: string;
          schedule_key: string;
          sent_at: string | null;
          status: string;
          timezone_snapshot: string | null;
        };
        Insert: {
          created_at?: string;
          delivery_target_id: string;
          due_at: string;
          error_code?: string | null;
          expires_at: string;
          id?: string;
          kind: string;
          local_date?: string | null;
          part_states: Json;
          parts: Json;
          payload_version?: number;
          profile_id: string;
          schedule_key: string;
          sent_at?: string | null;
          status?: string;
          timezone_snapshot?: string | null;
        };
        Update: {
          created_at?: string;
          delivery_target_id?: string;
          due_at?: string;
          error_code?: string | null;
          expires_at?: string;
          id?: string;
          kind?: string;
          local_date?: string | null;
          part_states?: Json;
          parts?: Json;
          payload_version?: number;
          profile_id?: string;
          schedule_key?: string;
          sent_at?: string | null;
          status?: string;
          timezone_snapshot?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_delivery_target_id_profile_id_fkey";
            columns: ["delivery_target_id", "profile_id"];
            isOneToOne: false;
            referencedRelation: "delivery_targets";
            referencedColumns: ["id", "profile_id"];
          },
          {
            foreignKeyName: "notifications_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "research_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunities: {
        Row: {
          attributes: Json;
          canonical_url: string | null;
          content_hash: string;
          content_revision: number;
          country_codes: string[];
          created_at: string;
          cycle_key: string | null;
          description: string | null;
          event_end: string | null;
          event_start: string | null;
          field_provenance: Json;
          fingerprint: string;
          fingerprint_version: number;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          location_text: string | null;
          merged_into_id: string | null;
          organization: string | null;
          organization_key: string | null;
          parent_opportunity_id: string | null;
          published_at: string | null;
          qualification_tags: string[];
          quality_flags: string[];
          status: string;
          title: string;
          title_key: string;
          topics: string[];
          track_key: string | null;
          type_code: string;
          updated_at: string;
          work_mode: string;
        };
        Insert: {
          attributes?: Json;
          canonical_url?: string | null;
          content_hash: string;
          content_revision?: number;
          country_codes?: string[];
          created_at?: string;
          cycle_key?: string | null;
          description?: string | null;
          event_end?: string | null;
          event_start?: string | null;
          field_provenance?: Json;
          fingerprint: string;
          fingerprint_version: number;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          location_text?: string | null;
          merged_into_id?: string | null;
          organization?: string | null;
          organization_key?: string | null;
          parent_opportunity_id?: string | null;
          published_at?: string | null;
          qualification_tags?: string[];
          quality_flags?: string[];
          status?: string;
          title: string;
          title_key: string;
          topics?: string[];
          track_key?: string | null;
          type_code: string;
          updated_at?: string;
          work_mode?: string;
        };
        Update: {
          attributes?: Json;
          canonical_url?: string | null;
          content_hash?: string;
          content_revision?: number;
          country_codes?: string[];
          created_at?: string;
          cycle_key?: string | null;
          description?: string | null;
          event_end?: string | null;
          event_start?: string | null;
          field_provenance?: Json;
          fingerprint?: string;
          fingerprint_version?: number;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          location_text?: string | null;
          merged_into_id?: string | null;
          organization?: string | null;
          organization_key?: string | null;
          parent_opportunity_id?: string | null;
          published_at?: string | null;
          qualification_tags?: string[];
          quality_flags?: string[];
          status?: string;
          title?: string;
          title_key?: string;
          topics?: string[];
          track_key?: string | null;
          type_code?: string;
          updated_at?: string;
          work_mode?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunities_merged_into_id_fkey";
            columns: ["merged_into_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunities_parent_opportunity_id_fkey";
            columns: ["parent_opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunities_type_code_fkey";
            columns: ["type_code"];
            isOneToOne: false;
            referencedRelation: "opportunity_types";
            referencedColumns: ["code"];
          },
        ];
      };
      opportunity_assessments: {
        Row: {
          components: Json;
          eligible: boolean;
          evaluated_at: string;
          opportunity_id: string;
          opportunity_revision: number;
          profile_id: string;
          profile_revision: number;
          reason_codes: string[];
          rules_version: string;
          score: number | null;
          valid_until: string;
        };
        Insert: {
          components?: Json;
          eligible: boolean;
          evaluated_at?: string;
          opportunity_id: string;
          opportunity_revision: number;
          profile_id: string;
          profile_revision: number;
          reason_codes?: string[];
          rules_version: string;
          score?: number | null;
          valid_until: string;
        };
        Update: {
          components?: Json;
          eligible?: boolean;
          evaluated_at?: string;
          opportunity_id?: string;
          opportunity_revision?: number;
          profile_id?: string;
          profile_revision?: number;
          reason_codes?: string[];
          rules_version?: string;
          score?: number | null;
          valid_until?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_assessments_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunity_assessments_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "research_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunity_deadlines: {
        Row: {
          basis: string;
          created_at: string;
          due_at: string | null;
          due_date: string | null;
          id: string;
          kind: string;
          label: string;
          opportunity_id: string;
          precision: string;
          raw_value: string | null;
          revision: number;
          round_key: string;
          source_record_id: string | null;
          status: string;
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          basis: string;
          created_at?: string;
          due_at?: string | null;
          due_date?: string | null;
          id?: string;
          kind: string;
          label: string;
          opportunity_id: string;
          precision: string;
          raw_value?: string | null;
          revision?: number;
          round_key: string;
          source_record_id?: string | null;
          status?: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          basis?: string;
          created_at?: string;
          due_at?: string | null;
          due_date?: string | null;
          id?: string;
          kind?: string;
          label?: string;
          opportunity_id?: string;
          precision?: string;
          raw_value?: string | null;
          revision?: number;
          round_key?: string;
          source_record_id?: string | null;
          status?: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_deadlines_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunity_deadlines_source_record_id_opportunity_id_fkey";
            columns: ["source_record_id", "opportunity_id"];
            isOneToOne: false;
            referencedRelation: "source_records";
            referencedColumns: ["id", "opportunity_id"];
          },
        ];
      };
      opportunity_identities: {
        Row: {
          created_at: string;
          evidence: Json;
          id: string;
          key_version: number;
          kind: string;
          opportunity_id: string;
          source_record_id: string | null;
          value: string;
        };
        Insert: {
          created_at?: string;
          evidence?: Json;
          id?: string;
          key_version: number;
          kind: string;
          opportunity_id: string;
          source_record_id?: string | null;
          value: string;
        };
        Update: {
          created_at?: string;
          evidence?: Json;
          id?: string;
          key_version?: number;
          kind?: string;
          opportunity_id?: string;
          source_record_id?: string | null;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_identities_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunity_identities_source_record_id_opportunity_id_fkey";
            columns: ["source_record_id", "opportunity_id"];
            isOneToOne: false;
            referencedRelation: "source_records";
            referencedColumns: ["id", "opportunity_id"];
          },
        ];
      };
      opportunity_types: {
        Row: {
          code: string;
          created_at: string;
          enabled: boolean;
          family: string;
          label: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          enabled?: boolean;
          family: string;
          label: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          enabled?: boolean;
          family?: string;
          label?: string;
        };
        Relationships: [];
      };
      research_profiles: {
        Row: {
          created_at: string;
          digest_enabled: boolean;
          digest_local_time: string;
          display_name: string;
          enabled: boolean;
          id: string;
          reminders_enabled: boolean;
          revision: number;
          rules: Json;
          rules_schema_version: number;
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          digest_enabled?: boolean;
          digest_local_time?: string;
          display_name: string;
          enabled?: boolean;
          id?: string;
          reminders_enabled?: boolean;
          revision?: number;
          rules?: Json;
          rules_schema_version?: number;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          digest_enabled?: boolean;
          digest_local_time?: string;
          display_name?: string;
          enabled?: boolean;
          id?: string;
          reminders_enabled?: boolean;
          revision?: number;
          rules?: Json;
          rules_schema_version?: number;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      source_records: {
        Row: {
          error_code: string | null;
          first_seen_at: string;
          id: string;
          last_run_id: string | null;
          last_seen_at: string;
          metadata: Json;
          normalized_snapshot: Json | null;
          opportunity_id: string | null;
          parser_version: string;
          payload_hash: string;
          quality_flags: string[];
          record_status: string;
          source_id: string;
          source_record_key: string;
          source_revision: string | null;
          source_url: string;
        };
        Insert: {
          error_code?: string | null;
          first_seen_at?: string;
          id?: string;
          last_run_id?: string | null;
          last_seen_at?: string;
          metadata?: Json;
          normalized_snapshot?: Json | null;
          opportunity_id?: string | null;
          parser_version: string;
          payload_hash: string;
          quality_flags?: string[];
          record_status: string;
          source_id: string;
          source_record_key: string;
          source_revision?: string | null;
          source_url: string;
        };
        Update: {
          error_code?: string | null;
          first_seen_at?: string;
          id?: string;
          last_run_id?: string | null;
          last_seen_at?: string;
          metadata?: Json;
          normalized_snapshot?: Json | null;
          opportunity_id?: string | null;
          parser_version?: string;
          payload_hash?: string;
          quality_flags?: string[];
          record_status?: string;
          source_id?: string;
          source_record_key?: string;
          source_revision?: string | null;
          source_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_records_last_run_id_source_id_fkey";
            columns: ["last_run_id", "source_id"];
            isOneToOne: false;
            referencedRelation: "collection_runs";
            referencedColumns: ["id", "source_id"];
          },
          {
            foreignKeyName: "source_records_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "source_records_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
      sources: {
        Row: {
          adapter_version: string;
          approved_at: string | null;
          cadence_minutes: number;
          category: string;
          config: Json;
          config_version: number;
          consecutive_failures: number;
          cooldown_until: string | null;
          created_at: string;
          enabled: boolean;
          health_status: string;
          id: string;
          last_success_at: string | null;
          name: string;
          next_due_at: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          adapter_version: string;
          approved_at?: string | null;
          cadence_minutes?: number;
          category: string;
          config?: Json;
          config_version?: number;
          consecutive_failures?: number;
          cooldown_until?: string | null;
          created_at?: string;
          enabled?: boolean;
          health_status?: string;
          id?: string;
          last_success_at?: string | null;
          name: string;
          next_due_at?: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          adapter_version?: string;
          approved_at?: string | null;
          cadence_minutes?: number;
          category?: string;
          config?: Json;
          config_version?: number;
          consecutive_failures?: number;
          cooldown_until?: string | null;
          created_at?: string;
          enabled?: boolean;
          health_status?: string;
          id?: string;
          last_success_at?: string | null;
          name?: string;
          next_due_at?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      system_settings: {
        Row: {
          key: string;
          schema_version: number;
          updated_at: string;
          updated_by: string;
          value: Json;
        };
        Insert: {
          key: string;
          schema_version?: number;
          updated_at?: string;
          updated_by: string;
          value: Json;
        };
        Update: {
          key?: string;
          schema_version?: number;
          updated_at?: string;
          updated_by?: string;
          value?: Json;
        };
        Relationships: [];
      };
      telegram_updates: {
        Row: {
          action: Json | null;
          action_schema_version: number;
          bot_id: string;
          completed_at: string | null;
          delivery_target_id: string;
          error_code: string | null;
          payload_redacted_at: string | null;
          profile_id: string;
          received_at: string;
          status: string;
          update_id: number;
        };
        Insert: {
          action?: Json | null;
          action_schema_version?: number;
          bot_id: string;
          completed_at?: string | null;
          delivery_target_id: string;
          error_code?: string | null;
          payload_redacted_at?: string | null;
          profile_id: string;
          received_at?: string;
          status?: string;
          update_id: number;
        };
        Update: {
          action?: Json | null;
          action_schema_version?: number;
          bot_id?: string;
          completed_at?: string | null;
          delivery_target_id?: string;
          error_code?: string | null;
          payload_redacted_at?: string | null;
          profile_id?: string;
          received_at?: string;
          status?: string;
          update_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "telegram_updates_delivery_target_id_profile_id_bot_id_fkey";
            columns: ["delivery_target_id", "profile_id", "bot_id"];
            isOneToOne: false;
            referencedRelation: "delivery_targets";
            referencedColumns: ["id", "profile_id", "bot_id"];
          },
        ];
      };
      user_feedback: {
        Row: {
          action: string;
          context: Json;
          id: string;
          idempotency_key: string;
          occurred_at: string;
          opportunity_id: string;
          profile_id: string;
        };
        Insert: {
          action: string;
          context?: Json;
          id?: string;
          idempotency_key: string;
          occurred_at?: string;
          opportunity_id: string;
          profile_id: string;
        };
        Update: {
          action?: string;
          context?: Json;
          id?: string;
          idempotency_key?: string;
          occurred_at?: string;
          opportunity_id?: string;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_feedback_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_feedback_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "research_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_opportunity_state: {
        Row: {
          ignored: boolean;
          ignored_at: string | null;
          last_open_intent_at: string | null;
          opportunity_id: string;
          profile_id: string;
          saved: boolean;
          saved_at: string | null;
          updated_at: string;
        };
        Insert: {
          ignored?: boolean;
          ignored_at?: string | null;
          last_open_intent_at?: string | null;
          opportunity_id: string;
          profile_id: string;
          saved?: boolean;
          saved_at?: string | null;
          updated_at?: string;
        };
        Update: {
          ignored?: boolean;
          ignored_at?: string | null;
          last_open_intent_at?: string | null;
          opportunity_id?: string;
          profile_id?: string;
          saved?: boolean;
          saved_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_opportunity_state_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_opportunity_state_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "research_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      bind_pipeline_provenance: {
        Args: {
          p_key: string;
          p_record: string;
          p_source: string;
          p_value: Json;
        };
        Returns: Json;
      };
      cursor_digest: { Args: { p_cursor: Json }; Returns: string };
      enqueue_page_assessments: {
        Args: { p_keys: string[]; p_run: string; p_sequence: number };
        Returns: undefined;
      };
      enqueue_rerank: {
        Args: {
          p_after?: string;
          p_profile: string;
          p_request: string;
          p_upper?: string;
        };
        Returns: string;
      };
      finalize_run: {
        Args: { p_run: string; p_status: string };
        Returns: undefined;
      };
      item_eligible: {
        Args: {
          p_deadline?: string;
          p_kind: string;
          p_opportunity: string;
          p_profile: string;
          p_revision?: number;
        };
        Returns: boolean;
      };
      object_ok: { Args: { p_limit?: number; p_value: Json }; Returns: boolean };
      parts_ok: { Args: { p_parts: Json; p_states: Json }; Returns: boolean };
      paused: { Args: { p_key: string }; Returns: boolean };
      pipeline_opportunity: { Args: { p_id: string }; Returns: Json };
      profile_country: { Args: { p: string }; Returns: boolean };
      profile_rules_valid: { Args: { p: Json }; Returns: boolean };
      profile_text_valid: { Args: { p: string }; Returns: boolean };
      refresh_notification: { Args: { p_id: string }; Returns: undefined };
      require_lease: {
        Args: {
          p_generation: number;
          p_kind?: string;
          p_owner: string;
          p_task: string;
        };
        Returns: {
          attempts: number;
          available_at: string;
          coalescing_key: string | null;
          collection_run_id: string | null;
          created_at: string;
          expires_at: string | null;
          finished_at: string | null;
          id: string;
          kind: string;
          last_error_code: string | null;
          lease_generation: number;
          lease_owner: string | null;
          lease_until: string | null;
          max_attempts: number;
          payload: Json;
          payload_version: number;
          request_key: string;
          status: string;
          telegram_bot_id: string | null;
          telegram_update_id: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "job_tasks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      store_rejection: {
        Args: {
          p_code: string;
          p_hash: string;
          p_key: string;
          p_parser: string;
          p_run: string;
          p_source: string;
          p_status?: string;
          p_url: unknown;
        };
        Returns: undefined;
      };
      ui_action: {
        Args: { p_u: Database["radar"]["Tables"]["telegram_updates"]["Row"] };
        Returns: Json;
      };
      ui_callback: {
        Args: { p_action: Json; p_bot: string; p_target: string };
        Returns: Json;
      };
      ui_health: { Args: never; Returns: Json };
      ui_item: { Args: { p_id: string; p_profile: string }; Returns: Json };
      ui_patch: { Args: { p_id: string; p_patch: Json }; Returns: boolean };
      ui_profile: { Args: { p_id: string }; Returns: Json };
      ui_task: {
        Args: { p_generation: number; p_owner: string; p_task: string };
        Returns: {
          action: Json | null;
          action_schema_version: number;
          bot_id: string;
          completed_at: string | null;
          delivery_target_id: string;
          error_code: string | null;
          payload_redacted_at: string | null;
          profile_id: string;
          received_at: string;
          status: string;
          update_id: number;
        };
        SetofOptions: {
          from: "*";
          to: "telegram_updates";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      upsert_record: {
        Args: { p_record: Json; p_run: string; p_source: string };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]
    )
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (
    & DefaultSchema["Tables"]
    & DefaultSchema["Views"]
  ) ? (
      & DefaultSchema["Tables"]
      & DefaultSchema["Views"]
    )[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends
    {
      Insert: infer I;
    } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends
    {
      Update: infer U;
    } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][
    CompositeTypeName
  ]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  public: {
    Enums: {},
  },
  radar: {
    Enums: {},
  },
} as const;
