const mongoose = require('mongoose');

const UsersDetailSchema = new mongoose.Schema({
  Badge: mongoose.Schema.Types.Mixed, // 支持数字和字符串
  Name: String,
  EName: String,
  CompID: Number,
  grade1desc: String,
  grade2desc: String,
  grade3desc: String,
  grade4desc: String,
  grade5desc: String,
  grade6desc: String,
  depiddesc: String,
  DepartmentCode: String, // 部门编码,用于部门权限匹配
  jobiddesc: String,
  jobidEdesc: String,
  JobMOAName: String,
  workcitydesc: String,
  email: String,
  TEL: mongoose.Schema.Types.Mixed,
  Gender: Number,
  sjBadge: Number,
  sjname: String,
  jjbadge: Number,
  jjname: String,
  jjBxBadge: Number,
  jjBxname: String,
  eMail_pers: String,
  compEmail: String,
  maxupdatetime: String
}, {
  collection: 'users_detail',
  strict: false // 允许读取schema中未定义的字段
});

UsersDetailSchema.index({ Badge: 1 });
module.exports = mongoose.model('UsersDetail', UsersDetailSchema);
