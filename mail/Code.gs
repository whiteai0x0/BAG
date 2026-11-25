function doPost(e) {
  var sent = false;
  try {
    var data = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');
    if (secret && data.secret === secret && typeof data.email === 'string' &&
        /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(data.email) &&
        typeof data.code === 'string' && /^\d{6}$/.test(data.code)) {
      MailApp.sendEmail(data.email, 'Your BAG verification code',
        'Enter ' + data.code + ' in BAG to verify your email. It expires in 10 minutes. If you did not request this, ignore this email.',
        {name: 'BAG'});
      sent = true;
    }
  } catch (error) {}
  return ContentService.createTextOutput(JSON.stringify({sent: sent})).setMimeType(ContentService.MimeType.JSON);
}
