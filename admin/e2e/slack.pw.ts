import {test,expect,openOwnerClients} from './fixtures';
test('Slack MCP connections show coverage and explicit verification',async({page,brain})=>{
 await openOwnerClients(page,brain);
 await page.route('**/admin/api/connections/slack',r=>r.fulfill({json:{sources:[{id:'slack',server:'slack',channels:['C12345678']}],coverage:'Channel history only'}}));
 await page.route('**/admin/api/connections/slack/check',r=>r.fulfill({json:{connected:true,message:'MCP handshake verified'}}));
 await page.getByText('Connections',{exact:true}).click();await expect(page.getByText('Channel history only',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Verify MCP'}).click();await expect(page.getByRole('status')).toContainText('MCP handshake verified');
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Refresh Status'})).toBeVisible();
});
