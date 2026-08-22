INSERT INTO admin_permissions(code,name,module,description) VALUES
 ('groups.member-limit.read','查看群人数上限','group','查看单群人数配置'),
 ('groups.member-limit.write','修改群人数上限','group','修改单群人数配置并记录审计')
ON CONFLICT(code) DO NOTHING;

-- 已拥有群设置权限的角色自动获得新权限，避免升级后超级管理员看不到入口。
INSERT INTO admin_role_permissions(role_id,permission_id)
SELECT rp.role_id,p.id
FROM admin_role_permissions rp
JOIN admin_permissions oldp ON oldp.id=rp.permission_id AND oldp.code='groups.settings'
CROSS JOIN admin_permissions p
WHERE p.code IN ('groups.member-limit.read','groups.member-limit.write')
ON CONFLICT DO NOTHING;
