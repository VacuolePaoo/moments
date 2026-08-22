"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DatabaseBackupIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import {
  apiDocumentationUrl,
  clearAllPosts,
  createCompleteBackup,
  getHealth,
  getSettings,
  MomentsApiError,
  previewBackupRestore,
  rebuildStatistics,
  restoreCompleteBackup,
  retryRead,
  updateSettings,
  type AppSettings,
  type CompleteBackup,
  type HealthStatus,
  type RestoreBackupPreview,
  type RestoreBackupResult,
  type UpdateSettings,
} from "./api";
import { useAdminAccess } from "./auth-controls";
import { clearCachedHomeFeed } from "./feed-cache";
import { MomentsShell } from "./moments-shell";
import { PageTitle } from "./page-title";
import { useSiteSettings } from "./site-settings";

const CLEAR_CONFIRMATION = "确认清空全部说说";
const MAX_RESTORE_FILE_BYTES = 15 * 1024 * 1024;
const BODY_TEXT_CLASS = "text-base leading-6 font-normal";
const SECTION_TITLE_CLASS = "text-[1.602rem] leading-[1.5] font-semibold";

interface RestoreCandidate {
  backup: CompleteBackup;
  preview: RestoreBackupPreview;
}

export function MomentsSettings() {
  const router = useRouter();
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, isCheckingAdmin, getToken } = useAdminAccess();
  const { fileUploadConfigured, applySettings } = useSiteSettings();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [clearConfirmation, setClearConfirmation] = useState("");
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [restoreCandidate, setRestoreCandidate] =
    useState<RestoreCandidate | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const [nextSettings, nextHealth] = await Promise.all([
        retryRead(() => getSettings(token)),
        retryRead(() => getHealth()),
      ]);
      setSettings(nextSettings);
      applySettings(nextSettings);
      setHealth(nextHealth);
      setError(null);
    } catch {
      setError("设置加载失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }, [applySettings, getToken]);

  useEffect(() => {
    if (isCheckingAdmin) return;
    if (!isAdmin) {
      router.replace("/");
      return;
    }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [isAdmin, isCheckingAdmin, load, router]);

  async function save(
    update: UpdateSettings,
    action: string,
    successMessage: string,
  ) {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const updated = await updateSettings(update, token);
      setSettings(updated);
      applySettings(updated);
      toast.add({ type: "success", description: successMessage });
    } catch {
      toast.add({ type: "error", description: "设置保存失败，请稍后重试。" });
    } finally {
      setPendingAction(null);
    }
  }

  async function downloadBackup() {
    if (pendingAction) return;
    setPendingAction("backup");
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const backup = await createCompleteBackup(token);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `moments-backup-${backup.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.add({ type: "success", description: "完整备份已生成。" });
    } catch {
      toast.add({ type: "error", description: "备份生成失败，请稍后重试。" });
    } finally {
      setPendingAction(null);
    }
  }

  function applyRestoreResult(result: RestoreBackupResult) {
    setSettings(result.settings);
    applySettings(result.settings);
    clearCachedHomeFeed();
    toast.add({
      type: "success",
      description:
        result.overwrittenPosts > 0
          ? `已恢复 ${result.restoredPosts} 条说说，其中覆盖 ${result.overwrittenPosts} 条。`
          : `已恢复 ${result.restoredPosts} 条说说。`,
    });
  }

  function restoreErrorDescription(error: unknown): string {
    if (error instanceof SyntaxError) return "备份文件不是有效的 JSON。";
    if (error instanceof MomentsApiError) {
      if (error.code === "VALIDATION_ERROR") {
        return "备份格式、版本或内容无效。";
      }
      if (error.code === "PAYLOAD_TOO_LARGE") return "备份文件过大。";
      if (error.code === "BACKUP_CONFLICT") {
        return "恢复期间检测到新的 ID 冲突，请重新选择备份文件。";
      }
    }
    return "备份恢复失败，数据库未被修改。";
  }

  async function selectRestoreFile(file: File) {
    if (pendingAction) return;
    if (file.size > MAX_RESTORE_FILE_BYTES) {
      toast.add({ type: "error", description: "备份文件不能超过 15 MB。" });
      return;
    }

    setPendingAction("restore-preview");
    try {
      const backup = JSON.parse(await file.text()) as CompleteBackup;
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const preview = await previewBackupRestore(backup, token);
      if (preview.conflictCount > 0) {
        setRestoreCandidate({ backup, preview });
        return;
      }

      try {
        applyRestoreResult(
          await restoreCompleteBackup(backup, false, token),
        );
      } catch (restoreError) {
        if (
          restoreError instanceof MomentsApiError &&
          restoreError.code === "BACKUP_CONFLICT"
        ) {
          const refreshedPreview = await previewBackupRestore(backup, token);
          setRestoreCandidate({ backup, preview: refreshedPreview });
          return;
        }
        throw restoreError;
      }
    } catch (restoreError) {
      toast.add({
        type: "error",
        description: restoreErrorDescription(restoreError),
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmRestoreOverwrite() {
    if (pendingAction || !restoreCandidate) return;
    setPendingAction("restore");
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const result = await restoreCompleteBackup(
        restoreCandidate.backup,
        true,
        token,
      );
      applyRestoreResult(result);
      setRestoreCandidate(null);
    } catch (restoreError) {
      toast.add({
        type: "error",
        description: restoreErrorDescription(restoreError),
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function refreshStatistics() {
    if (pendingAction || !settings?.features.statistics) return;
    setPendingAction("statistics-rebuild");
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      await rebuildStatistics(token);
      toast.add({ type: "success", description: "统计数据已重新计算。" });
    } catch {
      toast.add({ type: "error", description: "统计刷新失败，请稍后重试。" });
    } finally {
      setPendingAction(null);
    }
  }

  async function confirmClearPosts() {
    if (pendingAction || clearConfirmation !== CLEAR_CONFIRMATION) return;
    setPendingAction("clear");
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const result = await clearAllPosts(clearConfirmation, token);
      clearCachedHomeFeed();
      setClearDialogOpen(false);
      setClearConfirmation("");
      toast.add({
        type: "success",
        description: `已清空 ${result.deletedPosts} 条说说和 ${result.deletedImages} 张图片。`,
      });
    } catch {
      toast.add({ type: "error", description: "清空失败，数据未从 D1 删除。" });
    } finally {
      setPendingAction(null);
    }
  }

  if (!isAdmin) {
    return (
      <MomentsShell>
        {isCheckingAdmin ? <SettingsSkeleton /> : null}
      </MomentsShell>
    );
  }

  return (
    <MomentsShell>
      <div className="mx-auto w-full max-w-[640px]">
        <PageTitle>设置</PageTitle>

        {isLoading ? <SettingsSkeleton /> : null}
        {!isLoading && error ? (
          <div className="flex items-center gap-3" role="alert">
            <p className="text-base leading-6 text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              重试
            </Button>
          </div>
        ) : null}

        {!isLoading && !error && settings ? (
          <Tabs defaultValue="system" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-3">
              <TabsTrigger value="system">系统</TabsTrigger>
              <TabsTrigger value="features">功能</TabsTrigger>
              <TabsTrigger value="content">内容</TabsTrigger>
            </TabsList>

            <TabsContent value="system" className="flex flex-col gap-12 pt-8">
              <SiteInformationSection
                settings={settings}
                pending={pendingAction === "site"}
                onChange={setSettings}
                onSave={() =>
                  void save({ site: settings.site }, "site", "站点信息已保存。")
                }
              />
              <RuntimeStatusSection
                health={health}
                fileUploadConfigured={fileUploadConfigured}
              />
              <DatabaseOperationsSection
                restoreInputRef={restoreInputRef}
                statisticsEnabled={settings.features.statistics}
                pendingAction={pendingAction}
                clearDialogOpen={clearDialogOpen}
                clearConfirmation={clearConfirmation}
                onBackup={() => void downloadBackup()}
                onRestoreFile={(file) => void selectRestoreFile(file)}
                onRefreshStatistics={() => void refreshStatistics()}
                onClearDialogOpenChange={(open) => {
                  setClearDialogOpen(open);
                  if (!open) setClearConfirmation("");
                }}
                onClearConfirmationChange={setClearConfirmation}
                onClear={() => void confirmClearPosts()}
              />
            </TabsContent>

            <TabsContent value="features" className="pt-8">
              <FeatureSettingsSection
                settings={settings}
                pendingAction={pendingAction}
                onToggle={(feature, enabled) =>
                  void save(
                    { features: { [feature]: enabled } },
                    `feature-${feature}`,
                    "功能设置已保存。",
                  )
                }
                onRefreshStatistics={() => void refreshStatistics()}
              />
            </TabsContent>

            <TabsContent value="content" className="pt-8">
              <ContentSettingsSection
                settings={settings}
                pendingAction={pendingAction}
                onChange={setSettings}
                onTogglePublic={(enabled) =>
                  void save(
                    { content: { public: enabled } },
                    "content-public",
                    "内容公开设置已保存。",
                  )
                }
                onSavePageSize={() =>
                  void save(
                    { content: { pageSize: settings.content.pageSize } },
                    "page-size",
                    "每次加载数量已保存。",
                  )
                }
              />
            </TabsContent>
          </Tabs>
        ) : null}
      </div>

      <AlertDialog
        open={restoreCandidate !== null}
        onOpenChange={(open) => {
          if (!open && pendingAction !== "restore") setRestoreCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖相同 ID 的说说？</AlertDialogTitle>
            <AlertDialogDescription>
              当前数据库中有 {restoreCandidate?.preview.conflictCount ?? 0} 条说说与备份 ID 相同。继续后将以备份内容覆盖这些记录，同时恢复备份中的站点设置；此操作不会修改图床文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction === "restore"}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingAction === "restore"}
              onClick={(event) => {
                event.preventDefault();
                void confirmRestoreOverwrite();
              }}
            >
              {pendingAction === "restore" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              确认覆盖并恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MomentsShell>
  );
}

function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      <h2 id={id} className={SECTION_TITLE_CLASS}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SiteInformationSection({
  settings,
  pending,
  onChange,
  onSave,
}: {
  settings: AppSettings;
  pending: boolean;
  onChange: (settings: AppSettings) => void;
  onSave: () => void;
}) {
  return (
    <SettingsSection id="site-information-heading" title="站点信息">
      <FieldGroup>
        <Field orientation="horizontal" data-disabled={pending}>
          <FieldContent>
            <FieldTitle className={BODY_TEXT_CLASS}>显示站点名称</FieldTitle>
          </FieldContent>
          <Switch
            aria-label="显示站点名称"
            checked={settings.site.showName}
            disabled={pending}
            onCheckedChange={(checked) =>
              onChange({
                ...settings,
                site: { ...settings.site, showName: checked },
              })
            }
          />
        </Field>
        {settings.site.showName ? (
          <Field data-disabled={pending}>
            <FieldLabel htmlFor="site-name" className={BODY_TEXT_CLASS}>
              站点名称
            </FieldLabel>
            <Input
              id="site-name"
              value={settings.site.name}
              maxLength={80}
              disabled={pending}
              onChange={(event) =>
                onChange({
                  ...settings,
                  site: { ...settings.site, name: event.target.value },
                })
              }
            />
            <FieldDescription>未设置时默认显示 Moments。</FieldDescription>
          </Field>
        ) : null}
        <Field data-disabled={pending}>
          <FieldLabel htmlFor="site-description" className={BODY_TEXT_CLASS}>
            站点简介
          </FieldLabel>
          <Textarea
            id="site-description"
            value={settings.site.description}
            maxLength={280}
            className="min-h-24 resize-none text-base leading-6"
            disabled={pending}
            onChange={(event) =>
              onChange({
                ...settings,
                site: { ...settings.site, description: event.target.value },
              })
            }
          />
        </Field>
      </FieldGroup>
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={pending || settings.site.name.trim().length === 0}
          onClick={onSave}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          保存站点信息
        </Button>
      </div>
    </SettingsSection>
  );
}

function RuntimeStatusSection({
  health,
  fileUploadConfigured,
}: {
  health: HealthStatus | null;
  fileUploadConfigured: boolean;
}) {
  return (
    <SettingsSection id="runtime-status-heading" title="运行状态">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={BODY_TEXT_CLASS}>项目</TableHead>
            <TableHead className={`${BODY_TEXT_CLASS} text-right`}>
              状态
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <StatusRow
            title="后端"
            value={health ? health.status === "ok" : null}
            positive="正常"
            negative="不可用"
          />
          <StatusRow
            title="数据库"
            value={health ? health.database === "ok" : null}
            positive="正常"
            negative="不可用"
          />
          <StatusRow
            title="文件上传"
            value={fileUploadConfigured}
            positive="已配置"
            negative="未配置"
          />
          <StatusRow
            title="文件操作"
            value={health?.fileOperationsConfigured ?? null}
            positive="已配置"
            negative="未配置"
          />
          <TableRow>
            <TableCell className={BODY_TEXT_CLASS}>接口文档</TableCell>
            <TableCell className="text-right">
              <Button
                variant="outline"
                size="sm"
                render={
                  <a
                    href={apiDocumentationUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                nativeButton={false}
              >
                打开
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </SettingsSection>
  );
}

function StatusRow({
  title,
  value,
  positive,
  negative,
}: {
  title: string;
  value: boolean | null;
  positive: string;
  negative: string;
}) {
  return (
    <TableRow>
      <TableCell className={BODY_TEXT_CLASS}>{title}</TableCell>
      <TableCell className="text-right">
        <Badge
          variant={value === null ? "outline" : value ? "default" : "destructive"}
        >
          {value === null ? "检测中" : value ? positive : negative}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

function DatabaseOperationsSection({
  restoreInputRef,
  statisticsEnabled,
  pendingAction,
  clearDialogOpen,
  clearConfirmation,
  onBackup,
  onRestoreFile,
  onRefreshStatistics,
  onClearDialogOpenChange,
  onClearConfirmationChange,
  onClear,
}: {
  restoreInputRef: React.RefObject<HTMLInputElement | null>;
  statisticsEnabled: boolean;
  pendingAction: string | null;
  clearDialogOpen: boolean;
  clearConfirmation: string;
  onBackup: () => void;
  onRestoreFile: (file: File) => void;
  onRefreshStatistics: () => void;
  onClearDialogOpenChange: (open: boolean) => void;
  onClearConfirmationChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <SettingsSection id="database-operations-heading" title="数据库操作">
      <FieldGroup>
        <ActionField title="完整备份">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pendingAction !== null}
            onClick={onBackup}
          >
            {pendingAction === "backup" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <DatabaseBackupIcon data-icon="inline-start" />
            )}
            导出
          </Button>
        </ActionField>
        <ActionField
          title="恢复备份"
          description="恢复全部说说与站点设置，不会上传、删除或校验图床文件。"
        >
          <Input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onRestoreFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pendingAction !== null}
            onClick={() => restoreInputRef.current?.click()}
          >
            {pendingAction === "restore-preview" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCcwIcon data-icon="inline-start" />
            )}
            导入
          </Button>
        </ActionField>
        <ActionField title="强制刷新统计数据">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!statisticsEnabled || pendingAction !== null}
            onClick={onRefreshStatistics}
          >
            {pendingAction === "statistics-rebuild" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            刷新
          </Button>
        </ActionField>
        <ActionField
          title="清空数据"
          description="永久删除全部说说及其托管图片，无法撤销。"
        >
          <AlertDialog
            open={clearDialogOpen}
            onOpenChange={onClearDialogOpenChange}
          >
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pendingAction !== null}
                />
              }
            >
              <Trash2Icon data-icon="inline-start" />
              清空
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清空全部说说？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作会先删除图床文件，全部成功后再清空 D1。请输入“{CLEAR_CONFIRMATION}”继续。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Field
                data-disabled={pendingAction !== null}
                data-invalid={
                  clearConfirmation.length > 0 &&
                  clearConfirmation !== CLEAR_CONFIRMATION
                }
              >
                <FieldLabel htmlFor="clear-confirmation">确认文字</FieldLabel>
                <Input
                  id="clear-confirmation"
                  value={clearConfirmation}
                  aria-invalid={
                    clearConfirmation.length > 0 &&
                    clearConfirmation !== CLEAR_CONFIRMATION
                  }
                  autoComplete="off"
                  disabled={pendingAction !== null}
                  onChange={(event) =>
                    onClearConfirmationChange(event.target.value)
                  }
                />
              </Field>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={
                    clearConfirmation !== CLEAR_CONFIRMATION ||
                    pendingAction !== null
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    onClear();
                  }}
                >
                  {pendingAction === "clear" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  确认清空
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ActionField>
      </FieldGroup>
    </SettingsSection>
  );
}

function ActionField({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle className={BODY_TEXT_CLASS}>{title}</FieldTitle>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      {children}
    </Field>
  );
}

function FeatureSettingsSection({
  settings,
  pendingAction,
  onToggle,
  onRefreshStatistics,
}: {
  settings: AppSettings;
  pendingAction: string | null;
  onToggle: (feature: keyof AppSettings["features"], enabled: boolean) => void;
  onRefreshStatistics: () => void;
}) {
  return (
    <SettingsSection id="feature-settings-heading" title="功能开关">
      <FieldGroup>
        <Field orientation="horizontal" data-disabled={pendingAction !== null}>
          <FieldContent>
            <FieldTitle className={BODY_TEXT_CLASS}>统计信息</FieldTitle>
          </FieldContent>
          <div className="flex shrink-0 items-center gap-2">
            {settings.features.statistics ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                onClick={onRefreshStatistics}
              >
                {pendingAction === "statistics-rebuild" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                刷新
              </Button>
            ) : null}
            <Switch
              aria-label="统计信息"
              checked={settings.features.statistics}
              disabled={pendingAction !== null}
              onCheckedChange={(checked) => onToggle("statistics", checked)}
            />
          </div>
        </Field>
        <FeatureSwitchField
          title="随机一天"
          checked={settings.features.random}
          disabled={pendingAction !== null}
          onCheckedChange={(checked) => onToggle("random", checked)}
        />
        <FeatureSwitchField
          title="RSS 订阅"
          checked={settings.features.rss}
          disabled={pendingAction !== null}
          onCheckedChange={(checked) => onToggle("rss", checked)}
        />
      </FieldGroup>
    </SettingsSection>
  );
}

function FeatureSwitchField({
  title,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled}>
      <FieldContent>
        <FieldTitle className={BODY_TEXT_CLASS}>{title}</FieldTitle>
      </FieldContent>
      <Switch
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </Field>
  );
}

function ContentSettingsSection({
  settings,
  pendingAction,
  onChange,
  onTogglePublic,
  onSavePageSize,
}: {
  settings: AppSettings;
  pendingAction: string | null;
  onChange: (settings: AppSettings) => void;
  onTogglePublic: (enabled: boolean) => void;
  onSavePageSize: () => void;
}) {
  return (
    <SettingsSection id="content-settings-heading" title="内容设置">
      <FieldGroup>
        <Field orientation="horizontal" data-disabled={pendingAction !== null}>
          <FieldContent>
            <FieldTitle className={BODY_TEXT_CLASS}>内容公开</FieldTitle>
            <FieldDescription>
              关闭后，未登录访问者无法读取页面或公开接口内容。
            </FieldDescription>
          </FieldContent>
          <Switch
            aria-label="内容公开"
            checked={settings.content.public}
            disabled={pendingAction !== null}
            onCheckedChange={onTogglePublic}
          />
        </Field>
        <Field data-disabled={pendingAction !== null}>
          <FieldLabel htmlFor="page-size" className={BODY_TEXT_CLASS}>
            每次加载数量
          </FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="page-size"
              type="number"
              min={1}
              max={100}
              value={settings.content.pageSize}
              disabled={pendingAction !== null}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isInteger(value)) return;
                onChange({
                  ...settings,
                  content: { ...settings.content, pageSize: value },
                });
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={
                pendingAction !== null ||
                settings.content.pageSize < 1 ||
                settings.content.pageSize > 100
              }
              onClick={onSavePageSize}
            >
              {pendingAction === "page-size" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              保存
            </Button>
          </div>
          <FieldDescription>允许设置 1–100 条，默认 20 条。</FieldDescription>
        </Field>
      </FieldGroup>
    </SettingsSection>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="正在加载设置">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
